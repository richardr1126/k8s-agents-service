"""Sub-agent runs recorded on `task` tool results: threads, transcripts and errors.

A `task` call runs a sub-agent and returns its final answer as a ToolMessage
whose artifact (`SubagentArtifact`) keeps the sub-agent's own messages, so
/history can show them and a later call can continue the same sub-agent
conversation by `thread_id`.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any, cast

from langchain_core.messages import BaseMessage, HumanMessage, ToolMessage, messages_from_dict
from langgraph.prebuilt.tool_node import ToolCallRequest

from schema.subagent import SubagentArtifact

THREAD_TAG = "thread_id"


def normalize_content(value: Any) -> str:
    """Message content as plain text, skipping reasoning and other non-text blocks."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(part for part in (normalize_content(item) for item in value) if part)
    if isinstance(value, dict):
        if value.get("type") not in (None, "text"):
            return ""
        if isinstance(value.get("text"), str):
            return value["text"]
        if "content" in value:
            return normalize_content(value["content"])
        try:
            return json.dumps(value, ensure_ascii=False)
        except Exception:
            return str(value)
    return str(value)


def subagent_runs(messages: list[BaseMessage]) -> list[SubagentArtifact]:
    """Every sub-agent run recorded on the conversation's `task` results, oldest first."""
    runs = []
    for message in messages:
        artifact = getattr(message, "artifact", None)
        if (
            isinstance(message, ToolMessage)
            and message.name == "task"
            and isinstance(artifact, dict)
            and artifact.get("type") == "subagent_run"
        ):
            runs.append(SubagentArtifact.model_validate(artifact))
    return runs


def new_thread_id(runs: list[SubagentArtifact], prefix: str) -> str:
    """Short, readable ids (`web-1`, `research-2`) that models copy back reliably."""
    used = {r.thread_id for r in runs if r.thread_id}
    n = 1
    while f"{prefix}-{n}" in used:
        n += 1
    return f"{prefix}-{n}"


def thread_transcript(runs: list[SubagentArtifact], thread_id: str) -> list[BaseMessage]:
    """The thread's earlier turns: each run's task, then what the sub-agent did and said."""
    transcript: list[BaseMessage] = []
    for run in runs:
        if run.thread_id != thread_id or run.status != "success":
            continue
        transcript.append(HumanMessage(content=run.description))
        transcript.extend(
            m for m in messages_from_dict(run.messages) if not isinstance(m, HumanMessage)
        )
    return transcript


def tag_threads(messages: list[BaseMessage]) -> list[BaseMessage]:
    """Show the model each task result's thread_id. Stored and streamed results stay clean."""
    out: list[BaseMessage] = []
    for message in messages:
        artifact = getattr(message, "artifact", None)
        thread_id = artifact.get("thread_id") if isinstance(artifact, dict) else None
        if isinstance(message, ToolMessage) and message.name == "task" and thread_id:
            text = normalize_content(message.content)
            message = message.model_copy(
                update={"content": f"{text}\n\n[{THREAD_TAG}: {thread_id}]"}
            )
        out.append(message)
    return out


class SubagentError(Exception):
    """A sub-agent failed; the parent gets an error result and carries on."""


def task_result(
    tool_call_id: str,
    run_id: str,
    subagent_type: str,
    description: str,
    content: str,
    **artifact: Any,
) -> ToolMessage:
    return ToolMessage(
        # The adapter streams TOOL_CALL_RESULT with this id; reusing the call id
        # keeps the live stream, the checkpoint and /history in agreement.
        id=tool_call_id,
        name="task",
        tool_call_id=tool_call_id,
        content=content,
        artifact=SubagentArtifact(
            subagent_run_id=run_id,
            subagent_type=subagent_type,
            description=description,
            **artifact,
        ).model_dump(),
    )


def errors_as_results(
    subagent_type: Callable[[dict[str, Any]], str],
) -> Callable[[ToolCallRequest, Callable[[ToolCallRequest], Awaitable[Any]]], Awaitable[Any]]:
    """A ToolNode wrapper returning a failed sub-agent to the parent model as an error result.

    The tool still raises, so the adapter emits SUBAGENT_ERROR; other errors
    propagate and end the run. `subagent_type` names the sub-agent from the call's args.
    """

    async def wrapper(
        request: ToolCallRequest, execute: Callable[[ToolCallRequest], Awaitable[Any]]
    ) -> Any:
        try:
            return await execute(request)
        except SubagentError as e:
            call = request.tool_call
            message = task_result(
                cast(str, call["id"]),  # ToolNode only runs calls that have an id
                request.runtime.config["configurable"]["checkpoint_ns"],
                subagent_type(call["args"]),
                str(call["args"].get("description", "")),
                str(e),
                status="error",
                error=str(e),
            )
            message.status = "error"
            return message

    return wrapper
