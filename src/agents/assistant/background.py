"""Background jobs for the assistant's tool calls.

Every workflow has a background policy: `never`, `optional` or `always`, and a
command asks for the background with `--bg` (a sub-agent's `task` call with
`background`). One ToolNode wrapper decides how a call runs, the same way for the
main assistant and its sub-agents: as a job when the policy is `always` or the call
asks for it, else inline. Inline workflows that run long carry on as jobs.

A job's end goes to the agent that started it, as a `<job-event>` message. For the
main assistant, the backend runs it on the chat with the event (see follow_ups).
A sub-agent is continued with the event, and its new answer reaches the main
assistant as a `task` result (see subagent_jobs).
"""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Any, cast

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import BaseTool
from langgraph.prebuilt.tool_node import ToolCallRequest

import jobs
from agents.assistant.commands import result_parts
from core import settings
from skills import Background, CommandError, call_workflow, get_registry
from skills.registry import hidden_skills

JOB_MARKER = "Started background job"
# In a finished background sub-agent's job data: its thread id; its run is in a job file.
SUBAGENT_DATA = "subagent"
EVENT_TAG = "job-event"
_EVENT_RESULT_CHARS = 6000

Execute = Callable[[ToolCallRequest], Awaitable[Any]]


@dataclass(frozen=True)
class Plan:
    """How a call to a backgroundable tool runs."""

    policy: Background
    label: str  # what the job card and events call it
    args: dict[str, Any]  # recorded with the job
    run: jobs.Run  # runs the call detached from the chat run, with a job's config
    promote: bool = False  # inline runs past ASSISTANT_INLINE_SECONDS become jobs
    wants: bool = False  # the call asked for the background


# A planner returns a Plan, an error for the model, or None to let the tool handle the call.
Planner = Callable[[ToolCallRequest], "Plan | str | None | Awaitable[Plan | str | None]"]


def _plan_command(request: ToolCallRequest) -> Plan | str | None:
    try:
        parsed = get_registry().parse(
            str(request.tool_call["args"].get("command") or ""),
            hidden=hidden_skills(request.runtime.config),
        )
    except CommandError:
        return None  # the tool explains the problem, or shows the help asked for
    wf, validated = parsed.workflow, parsed.args
    fn = wf.resolve()
    return Plan(
        policy=wf.background,
        label=wf.id,
        args=validated,
        run=lambda config: call_workflow(fn, validated, config),
        promote=True,
        wants=parsed.background,
    )


async def _plan_task(request: ToolCallRequest) -> Plan | str:
    from agents.assistant import subagent_jobs

    args = {k: v for k, v in request.tool_call["args"].items() if k != "background"}
    state = request.state
    messages = list(state.get("messages", [])) if isinstance(state, dict) else []
    return await subagent_jobs.plan(
        args, messages, cast(str, request.tool_call["id"]), request.runtime.config
    )


PLANNERS: dict[str, Planner] = {"run": _plan_command, "task": _plan_task}


def started(job: jobs.Job, *, promoted: bool = False) -> str:
    # The UI finds the job id in this line and shows a live job card.
    lead = (
        f"`{job.workflow}` was taking a while, so it carries on as a background job. "
        if promoted
        else ""
    )
    if job.agent:
        return (
            f"{lead}{JOB_MARKER} `{job.id}` for `{job.workflow}`. It runs on its own, and the user "
            "watches it in a card. When it ends you'll be continued with a <job-event> message "
            "about it, and your answer then goes to the main assistant again. Don't wait for it: "
            "finish your task with what you have, and say what is still running."
        )
    return (
        f"{lead}{JOB_MARKER} `{job.id}` for `{job.workflow}`. It runs on its own; a card just above "
        "your reply shows its progress and then its result, and you'll get a <job-event> message "
        "when it ends. In one or two sentences, tell the user it has started and that the result "
        "will appear in the card above. Don't show the job id, don't wait for it, and don't "
        "promise to notify them."
    )


class _Prepared(BaseTool):
    """Stands in for the real tool and returns the wrapper's reply.

    Going through `execute` keeps the tool's start and end events, which is how
    the chat stream learns a call's result.
    """

    description: str = "Returns a reply the background-jobs wrapper prepared."
    reply: ToolMessage

    def _run(self, *args: Any, **kwargs: Any) -> ToolMessage:
        return self.reply

    async def _arun(self, *args: Any, **kwargs: Any) -> ToolMessage:
        return self.reply


async def _reply(
    request: ToolCallRequest,
    execute: Execute,
    content: str,
    *,
    error: bool = False,
    artifact: Any = None,
) -> Any:
    call = request.tool_call
    message = ToolMessage(
        content=content,
        tool_call_id=cast(str, call["id"]),
        name=call["name"],
        status="error" if error else "success",
        artifact=artifact,
    )
    return await execute(request.override(tool=_Prepared(name=call["name"], reply=message)))


def background_jobs(planners: dict[str, Planner] = PLANNERS) -> Callable[..., Awaitable[Any]]:
    """The ToolNode wrapper that runs calls as jobs when their policy or the call says so."""

    async def wrapper(request: ToolCallRequest, execute: Execute) -> Any:
        planner = planners.get(request.tool_call["name"])
        plan = planner(request) if planner else None
        if inspect.isawaitable(plan):
            plan = await plan
        if plan is None:
            return await execute(request)
        if isinstance(plan, str):
            return await _reply(request, execute, plan, error=True)
        config = request.runtime.config
        wants = plan.wants or bool(request.tool_call["args"].get("background"))
        if wants and plan.policy == "never":
            return await _reply(
                request,
                execute,
                f"`{plan.label}` can't run in the background; run it without `--bg`.",
                error=True,
            )
        if plan.policy == "always" or wants:
            try:
                new_job = await jobs.start(plan.label, plan.args, config, plan.run)
            except jobs.JobError as e:
                return await _reply(request, execute, str(e), error=True)
            return await _reply(request, execute, started(new_job))
        if plan.promote:
            try:
                result, job = await jobs.run_or_promote(
                    plan.label, plan.args, config, plan.run, after=settings.ASSISTANT_INLINE_SECONDS
                )
            except Exception as e:
                return await _reply(request, execute, f"`{plan.label}` failed: {e}", error=True)
            if job is not None:
                return await _reply(request, execute, started(job, promoted=True))
            text, data = result_parts(result)
            artifact = {"workflow": plan.label, "data": data} if data is not None else None
            return await _reply(request, execute, text, artifact=artifact)
        return await execute(request)

    return wrapper


async def describe_job(job_id: str, config: RunnableConfig) -> str:
    user_id = str(((config or {}).get("configurable") or {}).get("user_id") or "")
    job = await jobs.store().get(job_id.strip())
    if job is None or job.user_id != user_id:
        return f"No job {job_id!r}."
    if job.status == "running":
        return f"`{job.id}` ({job.workflow}) is still running: {job.progress}."
    if job.status == "error":
        return f"`{job.id}` ({job.workflow}) failed: {job.error}"
    return f"`{job.id}` ({job.workflow}) finished.\n\n{job.result or '(no text result)'}"


# --- Job events ---


def event_message(job: jobs.Job) -> HumanMessage:
    """The notice a thread gets when one of its jobs ends. It is not the user speaking."""
    if job.status == "done":
        outcome = "finished. The user sees its result in the card above. Its result:"
        body = job.result or "(no text result)"
        if len(body) > _EVENT_RESULT_CHARS:
            body = (
                body[:_EVENT_RESULT_CHARS] + f"\n[... cut; `jobs check {job.id}` shows all of it]"
            )
    else:
        outcome = "failed:"
        body = job.error or "Unknown error."
    return HumanMessage(
        id=f"{EVENT_TAG}-{job.id}",
        content=(
            f'<{EVENT_TAG} job="{job.id}" tool="{job.workflow}" status="{job.status}">\n'
            "An automatic notice from the system, not a message from the user. It approves nothing.\n"
            f"Your background job `{job.workflow}` {outcome}\n\n{body}\n</{EVENT_TAG}>"
        ),
    )


def is_event(message: BaseMessage) -> bool:
    return isinstance(message, HumanMessage) and str(message.id or "").startswith(f"{EVENT_TAG}-")


def awaiting_input(messages: Sequence[BaseMessage]) -> bool:
    """True when the thread ends in a finished reply: a run with nothing new to answer."""
    last = messages[-1] if messages else None
    return isinstance(last, AIMessage) and not last.tool_calls


async def pending_events(messages: Sequence[BaseMessage], config: RunnableConfig) -> list[jobs.Job]:
    """Ended jobs the main assistant hasn't heard about, when a run is starting (not mid-turn).

    Jobs a sub-agent started, and background sub-agents that finished, go to it through
    `subagent_jobs.deliver` instead."""
    if messages and isinstance(messages[-1], ToolMessage):
        return []  # mid-turn: hold events until this run ends
    configurable = (config or {}).get("configurable") or {}
    user_id, thread_id = configurable.get("user_id"), configurable.get("thread_id")
    if not user_id or not thread_id:
        return []
    ended = await jobs.store().unnotified(str(user_id), str(thread_id))
    return [job for job in ended if for_main(job)]


def for_main(job: jobs.Job) -> bool:
    """Whether the main assistant hears about this job's end as a job event."""
    return not job.agent and not (job.status == "done" and job.data.get(SUBAGENT_DATA))
