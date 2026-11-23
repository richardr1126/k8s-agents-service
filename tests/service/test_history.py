from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from service.history import build_history


def roles(messages: list[dict]) -> list[str]:
    return [m["role"] for m in messages]


def test_reasoning_content_comes_back_before_its_reply() -> None:
    reply = AIMessage(
        id="ai-1",
        content="Blue light scatters most.",
        additional_kwargs={"reasoning_content": "Rayleigh."},
    )
    history = build_history([HumanMessage(id="h-1", content="Why blue?"), reply])
    assert roles(history.messages) == ["user", "reasoning", "assistant"]
    thinking = history.messages[1]
    assert thinking["content"] == "Rayleigh." and thinking["id"] == "ai-1-reasoning-0"


def test_readable_reasoning_details_are_kept_and_encrypted_ones_skipped() -> None:
    details = [
        {"type": "reasoning.text", "text": "First, "},
        {"type": "reasoning.summary", "summary": "then this."},
        {"type": "reasoning.encrypted", "data": "opaque"},
    ]
    reply = AIMessage(id="ai-1", content="Done.", additional_kwargs={"reasoning_details": details})
    assert build_history([reply]).messages[0]["content"] == "First, then this."

    hidden = AIMessage(
        id="ai-2",
        content="Done.",
        additional_kwargs={"reasoning_details": [{"type": "reasoning.encrypted", "data": "x"}]},
    )
    assert roles(build_history([hidden]).messages) == ["assistant"]


def test_a_tool_calling_reply_keeps_its_thinking() -> None:
    call = AIMessage(
        id="ai-1",
        content="",
        tool_calls=[{"id": "c1", "name": "web_search", "args": {"query": "x"}}],
        additional_kwargs={"reasoning_content": "Search first."},
    )
    result = ToolMessage(content="found", tool_call_id="c1", name="web_search")
    assert roles(build_history([call, result]).messages) == ["reasoning", "assistant", "tool"]
