"""Sub-agents and background jobs: the same rules as the main assistant.

A sub-agent can run in the background (`task` with `background=true`), and a
sub-agent can start background jobs of its own. Either way, the work ends up where
a sub-agent's work always does: as a `task` result on the chat, the record /history
shows as the sub-agent's panel and a later `task` call continues by `thread_id`.

- A background sub-agent checkpoints its steps under its job, so after a server
  restart it carries on from its last finished step (`run_job`). When it ends, its
  run is recorded on the chat as a `task` result.
- A job a sub-agent started belongs to that sub-agent (`Job.agent`). When it ends,
  the sub-agent is continued with the job's `<job-event>`, and that run is recorded
  the same way.

`deliver` does both for a chat's ended jobs, then the main assistant answers them,
from the follow-up run (see follow_ups).
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from typing import Any, cast
from uuid import uuid4

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    ToolMessage,
    messages_to_dict,
)
from langchain_core.runnables import RunnableConfig
from langchain_core.runnables.config import merge_configs

import jobs
from agents.assistant import agent as assistant
from agents.assistant.background import SUBAGENT_DATA, Plan, event_message, for_main
from agents.configurable_model_graph import ConfigurableModelGraph
from agents.delegation import (
    SubagentError,
    normalize_content,
    subagent_runs,
    task_result,
    thread_transcript,
)
from core import settings
from jobs.graphs import saver, thread_of
from schema.subagent import SubagentArtifact

logger = logging.getLogger(__name__)

LABEL_PREFIX = "agent:"
# The finished background sub-agent's run (a SubagentArtifact), kept with its job.
RUN_FILE = "subagent.json"

# Background sub-agents checkpoint to the job checkpointer, under `job:<job id>`.
_saved = ConfigurableModelGraph(lambda model: assistant._build(model, subagent=True))


async def running_agents(config: RunnableConfig | None) -> set[str]:
    """Thread ids of the chat's background sub-agents still running."""
    configurable = (config or {}).get("configurable") or {}
    user_id, thread_id = configurable.get("user_id"), jobs.chat_thread(configurable)
    if not user_id or not thread_id:
        return set()
    return {
        str(job.args.get("agent"))
        for job in await jobs.store().running_on(str(user_id), str(thread_id))
        if job.workflow.startswith(LABEL_PREFIX)
    }


async def plan(
    args: dict[str, Any], messages: list[BaseMessage], tool_call_id: str, config: RunnableConfig
) -> Plan | str:
    """How a `task` call runs in the background; an error for the model if it can't."""
    try:
        label, focus, thread_id, prior = assistant.prepare_task(
            messages,
            focus=args.get("focus"),
            thread_id=args.get("thread_id"),
            tool_call_id=tool_call_id,
            taken=await running_agents(config),
        )
    except SubagentError as e:
        return str(e)
    recorded = {
        "description": str(args.get("description") or ""),
        "focus": focus,
        "agent": thread_id,
    }

    async def run(config: RunnableConfig) -> Any:
        return await run_job(config, recorded, prior)

    return Plan(policy="optional", label=f"{LABEL_PREFIX}{label}", args=recorded, run=run)


def _resume(job: jobs.Job) -> jobs.Run | None:
    if not job.args.get("description") or not job.args.get("agent"):
        return None
    recorded = dict(job.args)

    async def run(config: RunnableConfig) -> Any:
        return await run_job(config, recorded, None)

    return run


jobs.on_resume(LABEL_PREFIX, _resume)


async def run_job(
    job_config: RunnableConfig, recorded: dict[str, Any], prior: list[BaseMessage] | None
) -> dict[str, Any]:
    """A background sub-agent: runs, or resumes after a restart, then keeps its run with the job."""
    configurable = dict(job_config.get("configurable") or {})
    job_id = str(configurable["job_id"])
    focus = recorded.get("focus") or None
    label = focus or assistant.GENERAL
    thread_id = str(recorded["agent"])
    model = configurable.get("model") or settings.DEFAULT_MODEL
    config: RunnableConfig = {
        "configurable": {
            "model": model,
            "user_id": configurable.get("user_id"),
            # Checkpoints under the job; its own jobs and searches belong to the chat.
            "thread_id": thread_of(job_id),
            "chat_thread_id": jobs.chat_thread(configurable),
            "focus": focus,
            "assistant_subagent": True,
            "subagent_thread": thread_id,
            "chat_focus": configurable.get("chat_focus"),
        },
        # What `jobs.graphs.saved_run` reads back to resume it.
        "metadata": {"job_model": model, "job_focus": focus, "lc_agent_name": label},
        "run_name": f"subagent:{label}",
        "recursion_limit": settings.AGENT_RECURSION_LIMIT,
    }
    _saved.checkpointer = saver()
    graph = _saved.graph_for_model(cast(Any, model))
    state = await graph.aget_state(config)
    description = str(recorded["description"])
    if state.next:
        logger.info("Resuming background sub-agent %s (job %s)", thread_id, job_id)
        final = await graph.ainvoke(None, config)
    elif state.values.get("messages"):
        final = state.values  # it finished before the restart; only recording the end was lost
    else:
        final = await graph.ainvoke(
            {"messages": [*(prior or []), HumanMessage(content=description)]}, config
        )
    messages: list[BaseMessage] = list(final["messages"])
    answer = normalize_content(messages[-1].content) if messages else ""
    artifact = SubagentArtifact(
        subagent_run_id=job_id,
        subagent_type=label,
        description=description,
        thread_id=thread_id,
        messages=messages_to_dict(_own(messages)),
    )
    await jobs.save_job_file(
        job_config, RUN_FILE, "application/json", artifact.model_dump_json().encode()
    )
    try:
        await saver().adelete_thread(thread_of(job_id))
    except Exception:
        logger.warning("Couldn't delete job %s's checkpoints", job_id, exc_info=True)
    return {"text": answer, "data": {SUBAGENT_DATA: thread_id}}


def _own(messages: list[BaseMessage]) -> list[BaseMessage]:
    """This run's own messages: everything after the task it was given."""
    last = max((i for i, m in enumerate(messages) if isinstance(m, HumanMessage)), default=-1)
    return messages[last + 1 :]


def _recorded(artifact: SubagentArtifact, answer: str) -> list[BaseMessage]:
    """The run as a `task` call and result on the chat, as if the assistant had made it."""
    call_id = f"call_{uuid4().hex[:24]}"
    focus = None if artifact.subagent_type == assistant.GENERAL else artifact.subagent_type
    call = AIMessage(
        content="",
        tool_calls=[
            {
                "name": "task",
                "args": {
                    "description": artifact.description,
                    "focus": focus,
                    "thread_id": artifact.thread_id,
                },
                "id": call_id,
                "type": "tool_call",
            }
        ],
    )
    fields = artifact.model_dump(
        exclude={"type", "v", "subagent_run_id", "subagent_type", "description"}
    )
    result: ToolMessage = task_result(
        call_id,
        artifact.subagent_run_id,
        artifact.subagent_type,
        artifact.description,
        answer,
        **fields,
    )
    if artifact.status == "error":
        result.status = "error"
    return [call, result]


async def _continue(
    runs: list[SubagentArtifact],
    thread_id: str,
    ended: list[jobs.Job],
    config: RunnableConfig,
) -> tuple[SubagentArtifact, str]:
    """Continues a sub-agent with its ended jobs' events; returns its run and answer."""
    label = next(r.subagent_type for r in reversed(runs) if r.thread_id == thread_id)
    focus = None if label == assistant.GENERAL else label
    description = "\n\n".join(str(event_message(job).content) for job in ended)
    prior = thread_transcript(runs, thread_id)
    run_id = f"follow-up:{uuid4().hex[:12]}"
    sub_config = merge_configs(
        config,
        {
            **assistant.subagent_config(
                label, focus, thread_id, ((config.get("configurable") or {}).get("focus"))
            ),
            "recursion_limit": settings.AGENT_RECURSION_LIMIT,
        },
    )
    try:
        result = await assistant.assistant_subagent.ainvoke(
            {"messages": [*prior, HumanMessage(content=description)]}, sub_config
        )
    except Exception as e:
        logger.exception("Continuing sub-agent %s failed", thread_id)
        error = f"Sub-agent '{label}' failed: {e}"
        artifact = SubagentArtifact(
            subagent_run_id=run_id,
            subagent_type=label,
            description=description,
            thread_id=thread_id,
            status="error",
            error=error,
        )
        return artifact, error
    messages: list[BaseMessage] = list(result["messages"])
    artifact = SubagentArtifact(
        subagent_run_id=run_id,
        subagent_type=label,
        description=description,
        thread_id=thread_id,
        messages=messages_to_dict(_own(messages)),
    )
    return artifact, normalize_content(messages[-1].content) if messages else ""


async def deliver(graph: Any, config: RunnableConfig, user_id: str, thread_id: str) -> bool:
    """Brings the chat's ended sub-agent work to it: finished background sub-agents, and
    sub-agents continued with the jobs they started. Records each as a `task` result,
    leaving the chat ready for the main assistant to answer. True if it recorded any."""
    store = jobs.store()
    ended = [job for job in await store.unnotified(user_id, thread_id) if not for_main(job)]
    if not ended:
        return False
    state = await graph.aget_state(config)
    runs = subagent_runs(list(state.values.get("messages", [])))
    still_running = await running_agents(
        {"configurable": {"user_id": user_id, "thread_id": thread_id}}
    )
    records: list[BaseMessage] = []
    told: list[str] = []

    # Background sub-agents that finished come first: their own jobs continue them.
    for job in (j for j in ended if not j.agent):
        found = await store.get_file(job.id, RUN_FILE)
        if found is None:
            await store.update(job.id, data={})  # nothing to record; the assistant hears of it
            continue
        artifact = SubagentArtifact.model_validate(json.loads(found[1]))
        records += _recorded(artifact, job.result or "")
        runs.append(artifact)
        told.append(job.id)

    by_agent: dict[str, list[jobs.Job]] = defaultdict(list)
    for job in ended:
        if job.agent:
            by_agent[job.agent].append(job)
    for agent, its_jobs in by_agent.items():
        if agent in still_running:
            continue  # it's continued once its own run ends
        if not any(r.thread_id == agent for r in runs):
            # Its run isn't on the chat (it failed, or the chat was reverted past it).
            for job in its_jobs:
                await store.update(job.id, agent=None)
            continue
        artifact, answer = await _continue(runs, agent, its_jobs, config)
        records += _recorded(artifact, answer)
        runs.append(artifact)
        told += [job.id for job in its_jobs]

    if not records:
        return False
    await graph.aupdate_state(config, {"messages": records}, as_node="tools")
    await store.mark_notified(told)
    logger.info("Recorded %d sub-agent runs on thread %s", len(records) // 2, thread_id)
    return True
