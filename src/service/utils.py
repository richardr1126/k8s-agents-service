from typing import Any

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    ToolMessage,
)
from langchain_core.messages import (
    ChatMessage as LangchainChatMessage,
)

from schema import ChatMessage

_REASONING_TYPE_MARKERS = {
    "reasoning", "thinking", "thought", "reasoning_content",
}
_REASONING_KEY_MARKERS = {
    "reasoning", "reasoning_content", "thinking", "thought", "summary", "thoughts",
}
_REASONING_TEXT_KEYS = {
    "text", "content", "reasoning", "reasoning_content", "thinking", "output_text",
}


def convert_message_content_to_string(content: str | list[str | dict]) -> str:
    if isinstance(content, str):
        return content
    text: list[str] = []
    for content_item in content:
        if isinstance(content_item, str):
            text.append(content_item)
            continue
        if not isinstance(content_item, dict):
            continue
        if content_item.get("type") == "text":
            chunk = content_item.get("text")
            if isinstance(chunk, str):
                text.append(chunk)
    return "".join(text)


def _collect_reasoning_text(data: Any, chunks: list[str], in_reasoning: bool = False) -> None:
    if isinstance(data, str):
        if in_reasoning and data != "":
            chunks.append(data)
        return

    if isinstance(data, list):
        for item in data:
            _collect_reasoning_text(item, chunks, in_reasoning=in_reasoning)
        return

    if not isinstance(data, dict):
        return

    raw_type = data.get("type")
    content_type = raw_type.lower() if isinstance(raw_type, str) else ""
    node_is_reasoning = (
        in_reasoning or content_type in _REASONING_TYPE_MARKERS or data.get("thought") is True
    )

    for key, value in data.items():
        key_name = key.lower()
        child_is_reasoning = node_is_reasoning or key_name in _REASONING_KEY_MARKERS
        if isinstance(value, (dict, list)):
            _collect_reasoning_text(value, chunks, in_reasoning=child_is_reasoning)
            continue
        if (
            isinstance(value, str)
            and child_is_reasoning
            and key_name in _REASONING_TEXT_KEYS
            and value != ""
        ):
            chunks.append(value)


def extract_reasoning_content(message: AIMessage) -> list[str]:
    chunks: list[str] = []
    _collect_reasoning_text(message.content, chunks)
    _collect_reasoning_text(message.additional_kwargs, chunks)
    _collect_reasoning_text(message.response_metadata, chunks)

    deduped: list[str] = []
    seen: set[str] = set()
    for chunk in chunks:
        if chunk in seen:
            continue
        seen.add(chunk)
        deduped.append(chunk)
    return deduped


def extract_reasoning_from_payload(payload: Any) -> list[str]:
    chunks: list[str] = []
    _collect_reasoning_text(payload, chunks)
    return chunks


def langchain_to_chat_message(message: BaseMessage) -> ChatMessage:
    """Create a ChatMessage from a LangChain message."""
    match message:
        case HumanMessage():
            human_message = ChatMessage(
                type="human",
                content=convert_message_content_to_string(message.content),
            )
            return human_message
        case AIMessage():
            ai_message = ChatMessage(
                type="ai",
                content=convert_message_content_to_string(message.content),
            )
            ai_message.reasoning_content = extract_reasoning_content(message)
            if message.tool_calls:
                ai_message.tool_calls = message.tool_calls
            if message.response_metadata:
                ai_message.response_metadata = message.response_metadata
            return ai_message
        case ToolMessage():
            tool_message = ChatMessage(
                type="tool",
                content=convert_message_content_to_string(message.content),
                tool_call_id=message.tool_call_id,
            )
            return tool_message
        case LangchainChatMessage():
            if message.role == "custom":
                custom_message = ChatMessage(
                    type="custom",
                    content="",
                    custom_data=message.content[0],
                )
                return custom_message
            raise ValueError(f"Unsupported chat message role: {message.role}")
        case _:
            raise ValueError(f"Unsupported message type: {message.__class__.__name__}")


def remove_tool_calls(content: str | list[str | dict]) -> str | list[str | dict]:
    """Remove tool calls from content."""
    if isinstance(content, str):
        return content
    # Currently only Anthropic models stream tool calls, using content item type tool_use.
    return [
        content_item
        for content_item in content
        if isinstance(content_item, str)
        or not isinstance(content_item, dict)
        or content_item.get("type") != "tool_use"
    ]


def _normalize_replayed_content(value: Any) -> str:
    """Normalize provider-native content blocks to plain text for replay."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = [_normalize_replayed_content(item) for item in value]
        return "".join(part for part in parts if part)
    if isinstance(value, dict):
        block_type = value.get("type")
        if block_type == "text" and isinstance(value.get("text"), str):
            return value["text"]
        if block_type in _REASONING_TYPE_MARKERS:
            if isinstance(value.get("text"), str):
                return value["text"]
            if "content" in value:
                return _normalize_replayed_content(value["content"])
            if "summary" in value:
                return _normalize_replayed_content(value["summary"])
            return ""
        if isinstance(value.get("text"), str):
            return value["text"]
        if "content" in value:
            return _normalize_replayed_content(value["content"])
        return ""
    return str(value)


def normalize_messages_for_replay(messages: list[BaseMessage]) -> list[BaseMessage]:
    """Return messages safe to replay across providers/backends."""
    normalized: list[BaseMessage] = []
    for message in messages:
        if isinstance(message, (AIMessage, ToolMessage)) and not isinstance(message.content, str):
            normalized.append(
                message.model_copy(update={"content": _normalize_replayed_content(message.content)})
            )
        else:
            normalized.append(message)
    return normalized
