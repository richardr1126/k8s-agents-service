"""The assistant: one agent with a small tool set, on-demand skills and copies of itself as sub-agents.

The chat's focus (picked by the user) comes in as `configurable.focus`. A
`task` call runs a copy of the assistant, optionally with another focus, in
its own context; copies can't start further copies or background jobs.
"""

from __future__ import annotations

from typing import Annotated, Any, cast
from uuid import uuid4

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
    messages_to_dict,
)
from langchain_core.runnables import RunnableConfig, RunnableLambda, RunnableSerializable
from langchain_core.runnables.config import merge_configs
from langchain_core.tools import BaseTool, InjectedToolCallId, tool
from langgraph.errors import GraphBubbleUp
from langgraph.graph import END, StateGraph
from langgraph.prebuilt import InjectedState, ToolNode

from agents.assistant.focus import get_focuses
from agents.assistant.prompt import build_prompt
from agents.assistant.tools import (
    fetch_page,
    list_skills,
    read_skill,
    run_workflow,
    search_richard,
    web_search,
)
from agents.compaction import CompactionManager, prompt_with_compaction_summary
from agents.configurable_model_graph import ConfigurableModelGraph
from agents.delegation import (
    SubagentError,
    errors_as_results,
    new_thread_id,
    normalize_content,
    subagent_runs,
    tag_threads,
    task_result,
    thread_transcript,
)
from agents.tool_loop import ToolLoopState, run_tool_loop_turn, send_pending_tool_calls
from core import get_model, settings
from schema.models import AllModelEnum
from service.utils import normalize_messages_for_replay

GENERAL = "general"


class AssistantState(ToolLoopState, total=False):
    pass


def _configurable(config: RunnableConfig | None) -> dict[str, Any]:
    return (config or {}).get("configurable") or {}


def _task_ordinal(messages: list[BaseMessage], tool_call_id: str) -> int:
    """This call's position among the `task` calls since the user's latest message, from 1."""
    turn: list[BaseMessage] = []
    for message in reversed(messages):
        if isinstance(message, HumanMessage):
            break
        turn.insert(0, message)
    ids = [
        call["id"]
        for message in turn
        if isinstance(message, AIMessage)
        for call in message.tool_calls
        if call["name"] == "task"
    ]
    return ids.index(tool_call_id) + 1 if tool_call_id in ids else len(ids) + 1


@tool
async def task(
    description: Annotated[
        str,
        "A specific, self-contained task. The sub-agent sees only this, never the conversation.",
    ],
    tool_call_id: Annotated[str, InjectedToolCallId],
    state: Annotated[dict[str, Any], InjectedState],
    config: RunnableConfig,
    focus: Annotated[
        str | None, "A focus for the sub-agent, from the list in your instructions."
    ] = None,
    thread_id: Annotated[
        str | None,
        "To continue an earlier sub-agent, the thread_id from the end of its result. Omit to start fresh.",
    ] = None,
) -> ToolMessage:
    """Start a copy of yourself with a fresh context, and return its final answer."""
    focus = (focus or "").strip() or None
    if focus and focus not in get_focuses():
        raise SubagentError(f"Unknown focus '{focus}'. Focuses: {', '.join(get_focuses())}.")
    limit = settings.ASSISTANT_MAX_SUBAGENTS_PER_TURN
    if _task_ordinal(state.get("messages", []), tool_call_id) > limit:
        raise SubagentError(f"At most {limit} sub-agents per turn. Continue with what you have.")
    label = focus or GENERAL

    runs = subagent_runs(state.get("messages", []))
    if thread_id:
        thread = [r for r in runs if r.thread_id == thread_id]
        if not thread:
            known = ", ".join(
                sorted({f"{r.thread_id} ({r.subagent_type})" for r in runs if r.thread_id})
            )
            raise SubagentError(
                f"Unknown thread_id '{thread_id}'. Known threads: {known or 'none'}. "
                "Omit thread_id to start a new thread."
            )
        if thread[0].subagent_type != label:
            raise SubagentError(
                f"Thread '{thread_id}' has focus '{thread[0].subagent_type}', not '{label}'."
            )
        prior = thread_transcript(runs, thread_id)
    else:
        thread_id = new_thread_id(runs, label)
        prior = []
    for message in prior:  # ids let this run's own messages be told apart afterwards
        message.id = message.id or str(uuid4())

    # The copy runs in this tool's checkpoint namespace with the parent's config,
    # so its events stream through the parent run, attributed by `lc_agent_name`.
    sub_config = merge_configs(
        config,
        {
            "metadata": {"lc_agent_name": label},
            "run_name": f"subagent:{label}",
            "configurable": {"focus": focus, "assistant_subagent": True},
        },
    )
    try:
        result = await assistant_subagent.ainvoke(
            {"messages": [*prior, HumanMessage(content=description)]}, sub_config
        )
    except GraphBubbleUp:
        raise
    except Exception as e:
        raise SubagentError(f"Sub-agent '{label}' failed: {e}") from e

    messages = result["messages"]
    seen = {m.id for m in prior if m.id}
    own = [m for m in messages if not isinstance(m, HumanMessage) and m.id not in seen]
    return task_result(
        tool_call_id,
        config["configurable"]["checkpoint_ns"],
        label,
        description,
        normalize_content(messages[-1].content),
        thread_id=thread_id,
        messages=messages_to_dict(own),
    )


BASE_TOOLS: list[BaseTool] = [
    web_search,
    fetch_page,
    search_richard,
    list_skills,
    read_skill,
    run_workflow,
]
MAIN_TOOLS: list[BaseTool] = [*BASE_TOOLS, task]

_COMPACTION_MANAGER = CompactionManager()


def _model_runnable(
    model: BaseChatModel, tools: list[BaseTool], *, subagent: bool, bind_tools: bool
) -> RunnableSerializable[AssistantState, AIMessage]:
    bound = model.bind_tools(tools) if bind_tools else model

    def model_input(state: AssistantState, config: RunnableConfig) -> list[BaseMessage]:
        messages = normalize_messages_for_replay(list(state["messages"]))
        if not subagent:
            messages = tag_threads(messages)
        prompt = build_prompt(
            focus=_configurable(config).get("focus"),
            subagent=subagent,
            max_tasks=settings.ASSISTANT_MAX_SUBAGENTS_PER_TURN,
        )
        return [
            SystemMessage(
                content=prompt_with_compaction_summary(prompt, cast(dict[str, Any], state))
            ),
            *messages,
        ]

    return cast(
        RunnableSerializable[AssistantState, AIMessage],
        RunnableLambda(model_input, name="StateModifier") | bound,
    )


def _build(model_name: AllModelEnum, *, subagent: bool):
    model = get_model(model_name)
    tools = BASE_TOOLS if subagent else MAIN_TOOLS
    with_tools = _model_runnable(model, tools, subagent=subagent, bind_tools=True)
    without_tools = _model_runnable(model, tools, subagent=subagent, bind_tools=False)

    async def acall_model(state: AssistantState, config: RunnableConfig) -> dict:
        return await run_tool_loop_turn(
            state=state,
            config=config,
            summary_model=model,
            model_runnable_with_tools=with_tools,
            model_runnable_without_tools=without_tools,
            compaction_manager=_COMPACTION_MANAGER,
        )

    graph = StateGraph(AssistantState)
    graph.add_node("model", acall_model)
    # Node name "tools" and one Send per tool call are what ag-ui-langgraph
    # relies on to attribute sub-agent events to their `task` call.
    graph.add_node(
        "tools",
        ToolNode(
            tools, awrap_tool_call=errors_as_results(lambda args: args.get("focus") or GENERAL)
        ),
    )
    graph.set_entry_point("model")
    graph.add_edge("tools", "model")
    graph.add_conditional_edges("model", send_pending_tool_calls, ["tools", END])
    return graph.compile(name="assistant-subagent" if subagent else "assistant")


assistant = ConfigurableModelGraph(lambda model_name: _build(model_name, subagent=False))
assistant_subagent = ConfigurableModelGraph(lambda model_name: _build(model_name, subagent=True))
