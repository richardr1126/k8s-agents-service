"""The assistant's one tool, `run`, and what the model sees of past tool calls.

The model works only in command lines: `run(command="web search ...")`. Two things
are stored differently from how the model wrote them:

- An `agent ...` command (a sub-agent) is stored as a `task` call with
  `subagent_type`, which is how ag-ui-langgraph recognizes a sub-agent and ties its
  stream to the call. `as_stored` makes that change as soon as the model's turn
  ends, before the call runs.
- Chats from before `run` hold calls to the older tools (`web_search`,
  `run_workflow`, `task`, ...).

`for_model` shows the model all of these as the `run` commands it would write now,
so the conversation it reads back is in one form. Stored messages are not changed.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from typing import Annotated, Any

from langchain_core.messages import AIMessage, BaseMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from skills import CommandError, CommandHelp, call_workflow, get_registry
from skills.command import quote, with_heredoc
from skills.registry import hidden_skills

RUN = "run"
TASK = "task"
GENERAL = "general"


def result_parts(result: Any) -> tuple[str, Any]:
    """A workflow's text for the model and its data for the chat's card."""
    if isinstance(result, dict) and result and set(result) <= {"text", "data"}:
        return str(result.get("text") or ""), result.get("data")
    if isinstance(result, str):
        return result, None
    return json.dumps(result, ensure_ascii=False, default=str), None


@tool(response_format="content_and_artifact")
async def run(
    command: Annotated[
        str,
        "One command line: a skill, its command and the arguments, e.g. "
        "'github commits openreader -L 5'. Quote values with spaces; long text goes in a heredoc.",
    ],
    config: RunnableConfig,
) -> tuple[str, dict[str, Any] | None]:
    """Run a command. `skills search <what you need>` finds commands, `<skill> --help` shows
    one skill's instructions and options, and `--bg` runs a command as a background job.
    """
    # Background runs and long inline runs are handled by the ToolNode's job wrapper;
    # this body runs a command inline and explains commands that can't run.
    try:
        parsed = get_registry().parse(command, hidden=hidden_skills(config))
    except CommandHelp as e:
        return str(e), None
    except CommandError as e:
        return str(e), None
    wf = parsed.workflow
    try:
        result = await call_workflow(wf.resolve(), parsed.args, config)
    except Exception as e:
        return f"`{wf.id}` failed: {e}", None
    text, data = result_parts(result)
    return text, {"workflow": wf.id, "data": data} if data is not None else None


# --- Sub-agents: `agent ...` is stored as `task` ---


def as_task(call: Mapping[str, Any]) -> dict[str, Any] | None:
    """The `task` call an `agent ...` command stands for, or None for any other call."""
    if call.get("name") != RUN:
        return None
    try:
        parsed = get_registry().parse(str(call.get("args", {}).get("command") or ""))
    except CommandError:
        return None  # `run` explains the mistake
    if parsed.workflow.skill != "agent":
        return None
    args: dict[str, Any] = {
        "description": parsed.args["brief"],
        # ag-ui-langgraph knows a call starts a sub-agent by this key; see agent._type_tasks.
        "subagent_type": parsed.args.get("type") or GENERAL,
    }
    if parsed.args.get("thread"):
        args["thread_id"] = parsed.args["thread"]
    if parsed.background:
        args["background"] = True
    return {**call, "name": TASK, "args": args}


def as_run(call: Mapping[str, Any]) -> dict[str, Any] | None:
    """A call named after a skill, as the `run` command it meant, or None for any other call.

    Some models call a skill as if it were a tool: `github(command="repo list")`.
    """
    name = str(call.get("name") or "")
    if name in (RUN, TASK) or name not in get_registry().skills:
        return None
    args = call.get("args") or {}
    rest = args.get("command") if isinstance(args, dict) else None
    command = f"{name} {rest}".strip() if isinstance(rest, str) else name
    return {**call, "name": RUN, "args": {"command": command}}


def as_stored(messages: list[BaseMessage], *, sub_agents: bool = True) -> list[BaseMessage]:
    """The model's new messages with skills called as tools turned into `run` calls and,
    with `sub_agents`, each `agent` command turned into a `task` call."""
    out: list[BaseMessage] = []
    for message in messages:
        if isinstance(message, AIMessage) and message.tool_calls:
            calls = [as_run(c) or c for c in message.tool_calls]
            if sub_agents:
                calls = [as_task(c) or c for c in calls]
            for call, original in zip(calls, message.tool_calls, strict=True):
                if call is not original:
                    original.update(call)  # type: ignore[typeddict-item]  # same message, ids stay
        out.append(message)
    return out


# --- What the model reads back ---


def _agent_command(args: dict[str, Any]) -> str:
    words = ["agent"]
    focus = str(args.get("subagent_type") or args.get("focus") or "").strip()
    if focus and focus != GENERAL:
        words += ["--type", quote(focus)]
    if args.get("thread_id"):
        words += ["--thread", quote(str(args["thread_id"]))]
    if args.get("background"):
        words.append("--bg")
    return with_heredoc(" ".join(words), str(args.get("description") or ""))


def _workflow_command(args: dict[str, Any]) -> str:
    command = str(args.get("command") or args.get("workflow") or "").strip()
    first, _, rest = command.partition(" ")
    if "." in first:
        command = " ".join([*first.split("."), rest]).strip()
    return f"{command} --bg" if args.get("background") else command


def _web_search(args: dict[str, Any]) -> str:
    words = ["web search", quote(str(args.get("query") or ""))]
    if args.get("max_results"):
        words += ["-n", str(args["max_results"])]
    if args.get("topic") == "news":
        words.append("--news")
        if args.get("days"):
            words += ["--days", str(args["days"])]
    return " ".join(words)


def _richard_search(args: dict[str, Any]) -> str:
    command = f"richard search {quote(str(args.get('query') or ''))}"
    source = args.get("source")
    return f"{command} --source {source}" if source and source != "all" else command


LEGACY: dict[str, Callable[[dict[str, Any]], str]] = {
    TASK: _agent_command,
    "run_workflow": _workflow_command,
    "web_search": _web_search,
    "fetch_page": lambda a: f"web read {quote(str(a.get('url') or ''))}",
    "search_richard": _richard_search,
    "check_job": lambda a: f"jobs check {quote(str(a.get('job_id') or ''))}",
    "list_skills": lambda a: "skills list",
    "read_skill": lambda a: f"{str(a.get('name') or 'skills').strip()} --help",
}


def for_model(messages: list[BaseMessage]) -> list[BaseMessage]:
    """The conversation as the model would have written it with `run`. Copies, never edits."""
    out: list[BaseMessage] = []
    for message in messages:
        if isinstance(message, AIMessage) and any(c["name"] in LEGACY for c in message.tool_calls):
            calls = [
                {**c, "name": RUN, "args": {"command": LEGACY[c["name"]](c.get("args") or {})}}
                if c["name"] in LEGACY
                else c
                for c in message.tool_calls
            ]
            message = message.model_copy(update={"tool_calls": calls})
        elif isinstance(message, ToolMessage) and message.name in LEGACY:
            message = message.model_copy(update={"name": RUN})
        out.append(message)
    return out
