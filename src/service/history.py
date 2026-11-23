"""Rebuild a thread's AG-UI message history, including sub-agent runs, from the checkpoint."""

from collections.abc import Sequence
from typing import Any

from ag_ui.core import ReasoningMessage
from ag_ui_langgraph.utils import langchain_messages_to_agui
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    ToolMessage,
    messages_from_dict,
)

from schema.subagent import HistoryResponse, SubagentArtifact, SubagentRunInfo

# OpenRouter's readable reasoning_details; "reasoning.encrypted" has nothing to show.
_READABLE_DETAILS = {"reasoning.text": "text", "reasoning.summary": "summary"}


def _saved_reasoning(message: AIMessage) -> str:
    """Thinking a provider returned outside the content blocks, as readable text.

    Chat Completions providers (OpenRouter, DeepSeek, Qwen, xAI) stream it as
    additional_kwargs.reasoning_content, which the adapter shows live; the
    adapter's history only reads content blocks, so it would vanish on reload.
    """
    if isinstance(message.content, list) and any(
        isinstance(b, dict) and b.get("type") in ("reasoning", "thinking") for b in message.content
    ):
        return ""  # the adapter converts these itself
    kwargs = message.additional_kwargs
    text = kwargs.get("reasoning_content")
    if isinstance(text, str) and text.strip():
        return text.strip()
    parts = []
    for detail in kwargs.get("reasoning_details") or []:
        field = _READABLE_DETAILS.get(str(detail.get("type"))) if isinstance(detail, dict) else None
        if field and isinstance(detail.get(field), str):
            parts.append(detail[field])
    return "".join(parts).strip()


def _with_reasoning(messages: list[BaseMessage], agui: list[Any]) -> list[Any]:
    """Puts each reply's saved thinking just before it, as the live stream does."""
    thinking = {
        str(m.id): text
        for m in messages
        if isinstance(m, AIMessage) and (text := _saved_reasoning(m))
    }
    if not thinking:
        return agui
    out: list[Any] = []
    for m in agui:
        if m.role == "assistant" and m.id in thinking:
            out.append(
                ReasoningMessage(id=f"{m.id}-reasoning-0", role="reasoning", content=thinking[m.id])
            )
        out.append(m)
    return out


def _to_agui(
    messages: list[BaseMessage], subagent_run_id: str | None = None
) -> list[dict[str, Any]]:
    return [
        m.model_copy(update={"subagent_run_id": subagent_run_id}).model_dump(
            mode="json", by_alias=True, exclude_none=True
        )
        for m in _with_reasoning(messages, langchain_messages_to_agui(messages))
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
