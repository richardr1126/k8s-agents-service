from typing import Any

import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig

from agents.compaction import CompactionManager


class _StubRunnable:
    def __init__(self, responses: list[AIMessage]) -> None:
        self._responses = responses
        self.calls = 0
        self.last_state: Any = None

    async def ainvoke(self, state: Any, _config: RunnableConfig) -> AIMessage:
        self.last_state = state
        idx = min(self.calls, len(self._responses) - 1)
        self.calls += 1
        return self._responses[idx]


@pytest.mark.asyncio
async def test_maybe_compact_rolls_summary_when_threshold_crossed() -> None:
    manager = CompactionManager()
    summary_model = _StubRunnable([AIMessage(content="rolled summary")])
    state = {
        "messages": [
            HumanMessage(content="turn 1"),
            AIMessage(
                content="turn 2",
                usage_metadata={"input_tokens": 80, "output_tokens": 30, "total_tokens": 110},
            ),
            HumanMessage(content="turn 3"),
        ]
    }

    outcome = await manager.maybe_compact(
        summary_model=summary_model,
        state=state,
        config=RunnableConfig(configurable={"compaction_trigger_tokens": 100}),
    )

    assert outcome.updated_summary == "rolled summary"
    assert outcome.anchor_signature
    assert outcome.invoke_state.get("compaction_summary") == "rolled summary"
    kept_messages = outcome.invoke_state.get("messages")
    assert isinstance(kept_messages, list)
    assert len(kept_messages) == 2
    assert isinstance(kept_messages[0], AIMessage)
    assert isinstance(kept_messages[1], HumanMessage)


@pytest.mark.asyncio
async def test_low_step_finalize_without_tools_uses_no_tools_runnable() -> None:
    manager = CompactionManager()
    no_tools = _StubRunnable([AIMessage(content="final direct answer")])
    state = {"messages": [HumanMessage(content="question")], "remaining_steps": 1}
    invoke_state = {"messages": [HumanMessage(content="question")]}
    response = AIMessage(
        content="",
        tool_calls=[{"name": "x", "args": {}, "id": "call_1", "type": "tool_call"}],
    )

    resolution = await manager.resolve_low_step_tool_call(
        state=state,
        invoke_state=invoke_state,
        response=response,
        config=RunnableConfig(configurable={"min_remaining_steps_for_tool_calls": 5}),
        model_runnable_without_tools=no_tools,
        updated_summary=None,
        anchor_signature=None,
    )

    assert resolution.response.content == "final direct answer"
    assert no_tools.calls == 1
    last_messages = no_tools.last_state.get("messages")
    assert isinstance(last_messages, list)
    assert isinstance(last_messages[-1], HumanMessage)
    assert "Do not call tools" in last_messages[-1].content


@pytest.mark.asyncio
async def test_low_step_guard_disabled_keeps_tool_calls() -> None:
    manager = CompactionManager()
    no_tools = _StubRunnable([AIMessage(content="should not be used")])
    state = {"messages": [HumanMessage(content="question")], "remaining_steps": 1}
    invoke_state = {
        "messages": [HumanMessage(content="question")]
    }
    response = AIMessage(
        content="",
        tool_calls=[{"name": "x", "args": {}, "id": "call_1", "type": "tool_call"}],
    )

    resolution = await manager.resolve_low_step_tool_call(
        state=state,
        invoke_state=invoke_state,
        response=response,
        config=RunnableConfig(configurable={"low_step_guard_enabled": False}),
        model_runnable_without_tools=no_tools,
        updated_summary=None,
        anchor_signature=None,
    )

    assert resolution.response is response
    assert no_tools.calls == 0


@pytest.mark.asyncio
async def test_maybe_compact_skips_when_disabled() -> None:
    manager = CompactionManager()
    summary_model = _StubRunnable([AIMessage(content="rolled summary")])
    state = {
        "messages": [
            HumanMessage(content="turn 1"),
            AIMessage(
                content="turn 2",
                usage_metadata={"input_tokens": 80, "output_tokens": 30, "total_tokens": 110},
            ),
            HumanMessage(content="turn 3"),
        ]
    }

    outcome = await manager.maybe_compact(
        summary_model=summary_model,
        state=state,
        config=RunnableConfig(
            configurable={"compaction_enabled": False, "compaction_trigger_tokens": 100}
        ),
    )

    assert outcome.updated_summary is None
    assert outcome.anchor_signature is None
    assert outcome.invoke_state is state
    assert summary_model.calls == 0
