"""Rebuild a thread's AG-UI message history, including sub-agent runs, from the checkpoint."""

from collections.abc import Sequence
from typing import Any

from ag_ui_langgraph.utils import langchain_messages_to_agui
from langchain_core.messages import BaseMessage, HumanMessage, ToolMessage, messages_from_dict

from schema.subagent import HistoryResponse, SubagentArtifact, SubagentRunInfo


def _to_agui(
    messages: list[BaseMessage], subagent_run_id: str | None = None
) -> list[dict[str, Any]]:
    return [
        m.model_copy(update={"subagent_run_id": subagent_run_id}).model_dump(
            mode="json", by_alias=True, exclude_none=True
        )
        for m in langchain_messages_to_agui(messages)
    ]


def _subagent_artifact(message: ToolMessage) -> SubagentArtifact | None:
    if message.name != "task":
        return None
    artifact = message.artifact
    if not isinstance(artifact, dict) or artifact.get("type") != "subagent_run":
        return None
    return SubagentArtifact.model_validate(artifact)


def build_history(messages: Sequence[BaseMessage]) -> HistoryResponse:
    """Root messages in order, each sub-agent's messages just before its `task` result."""
    out: list[dict[str, Any]] = []
    subagents: list[SubagentRunInfo] = []
    for message in messages:
        if isinstance(message, ToolMessage) and (artifact := _subagent_artifact(message)):
            run_id = artifact.subagent_run_id
            sub_messages = [
                m for m in messages_from_dict(artifact.messages) if not isinstance(m, HumanMessage)
            ]
            out.extend(_to_agui(sub_messages, run_id))
            subagents.append(
                SubagentRunInfo(
                    subagent_run_id=run_id,
                    parent_tool_call_id=message.tool_call_id,
                    name=artifact.subagent_type,
                    description=artifact.description,
                    status=artifact.status,
                    error=artifact.error,
                )
            )
        out.extend(_to_agui([message]))
    return HistoryResponse(messages=out, subagents=subagents)
