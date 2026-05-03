"""Shared state and execution helpers for tool-loop style agents."""

from typing import Any, Literal, cast

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, SystemMessage
from langchain_core.runnables import RunnableConfig, RunnableLambda, RunnableSerializable
from langchain_core.tools import BaseTool
from langgraph.graph import MessagesState
from langgraph.managed import RemainingSteps

from agents.compaction import CompactionManager, build_model_update, prompt_with_compaction_summary
from service.utils import normalize_messages_for_replay


class ToolLoopState(MessagesState, total=False):
    """Base state for agents that iterate over model -> tools -> model loops."""

    remaining_steps: RemainingSteps
    compaction_summary: str
    compaction_last_anchor_signature: str


def wrap_tool_loop_model(
    model: BaseChatModel,
    *,
    tools: list[BaseTool],
    prompt: str,
    bind_tools: bool = True,
    normalize_replay_messages: bool = False,
) -> RunnableSerializable[ToolLoopState, AIMessage]:
    """Build a model runnable with a dynamic system prompt and optional tool binding."""
    model_runnable = model.bind_tools(tools) if bind_tools else model
    preprocessor = RunnableLambda(
        lambda state: [SystemMessage(content=prompt_with_compaction_summary(prompt, state))]
        + (
            normalize_messages_for_replay(state["messages"])
            if normalize_replay_messages
            else state["messages"]
        ),
        name="StateModifier",
    )
    return preprocessor | model_runnable  # type: ignore[return-value]


async def run_tool_loop_turn(
    *,
    state: ToolLoopState,
    config: RunnableConfig,
    summary_model: Any,
    model_runnable_with_tools: Any,
    model_runnable_without_tools: Any,
    compaction_manager: CompactionManager,
) -> dict[str, Any]:
    """Run one model turn with compaction + low-step tool-call policy."""
    compaction_outcome = await compaction_manager.maybe_compact(
        summary_model=summary_model,
        state=state,
        config=config,
    )
    invoke_state = cast(ToolLoopState, compaction_outcome.invoke_state)
    response = cast(AIMessage, await model_runnable_with_tools.ainvoke(invoke_state, config))
    tool_call_resolution = await compaction_manager.resolve_low_step_tool_call(
        state=state,
        invoke_state=invoke_state,
        response=response,
        config=config,
        model_runnable_without_tools=model_runnable_without_tools,
        updated_summary=compaction_outcome.updated_summary,
        anchor_signature=compaction_outcome.anchor_signature,
    )
    return build_model_update(
        response=tool_call_resolution.response,
        updated_summary=tool_call_resolution.updated_summary,
        anchor_signature=tool_call_resolution.anchor_signature,
    )


def pending_tool_calls(state: ToolLoopState) -> Literal["tools", "done"]:
    """Route to tools only when the last AI message contains structured tool calls."""
    last_message = state["messages"][-1]
    if not isinstance(last_message, AIMessage):
        raise TypeError(f"Expected AIMessage, got {type(last_message)}")
    return "tools" if last_message.tool_calls else "done"
