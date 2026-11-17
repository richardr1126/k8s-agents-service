"""Revert a thread to just before one of its user messages by forking an earlier checkpoint."""

from typing import Any

from langchain_core.messages import BaseMessage, HumanMessage
from langchain_core.runnables import RunnableConfig

from agents import AgentGraph


class RevertError(LookupError):
    """The message is not in the thread, or is not a user message."""


def _text(message: BaseMessage) -> str:
    content = message.content
    if isinstance(content, str):
        return content
    return "".join(part if isinstance(part, str) else part.get("text", "") for part in content if isinstance(part, (str, dict)))


def _messages(values: Any) -> list[BaseMessage]:
    return list(values.get("messages", [])) if isinstance(values, dict) else []


async def revert_thread(graph: AgentGraph, thread_id: str, message_id: str) -> str:
    """Make the thread's head the newest checkpoint from before `message_id`; return that message's text.

    The fork (`as_node="__copy__"`) adds a checkpoint, so everything after the
    message is superseded rather than deleted. Reverting the first message
    clears the thread, since nothing came before it.
    """
    config = RunnableConfig(configurable={"thread_id": thread_id})
    head = await graph.aget_state(config)
    target = next((m for m in _messages(head.values) if m.id == message_id), None)
    if not isinstance(target, HumanMessage):
        raise RevertError(f"No user message {message_id} in thread {thread_id}")
    text = _text(target)

    async for snapshot in graph.aget_state_history(config):
        # Input checkpoints hold writes that were never applied; skip them.
        if (snapshot.metadata or {}).get("source") == "input":
            continue
        messages = _messages(snapshot.values)
        if not messages:
            break
        if all(m.id != message_id for m in messages):
            await graph.aupdate_state(snapshot.config, None, as_node="__copy__")
            return text

    checkpointer = graph.checkpointer
    if checkpointer is None or checkpointer is True:
        raise RuntimeError("Checkpointer not available")
    await checkpointer.adelete_thread(thread_id)
    return text
