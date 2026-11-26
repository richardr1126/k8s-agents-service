"""The assistant: one agent with one tool, `run`, that runs skills' commands, and copies
of itself as sub-agents.

The chat's focus (picked by the user) comes in as `configurable.focus`. An
`agent ...` command runs a copy of the assistant, optionally with another focus,
in its own context; copies can't start further copies. It is stored and run as
a `task` call (see commands). Background jobs work the same for both (see
background and subagent_jobs).
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

import jobs
from agents.assistant import background as bg
from agents.assistant.commands import as_stored, for_model, run
from agents.assistant.focus import get_focuses
from agents.assistant.prompt import build_prompt
from agents.compaction import CompactionManager, prompt_with_compaction_summary
from agents.configurable_model_graph import ConfigurableModelGraph
from agents.delegation import (
    SubagentError,
    errors_as_results,
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


def focus_of(args: dict[str, Any]) -> str | None:
    """A `task` call's focus: its `subagent_type` (`focus` in calls made before the rename)."""
    focus = str(args.get("subagent_type") or args.get("focus") or "").strip()
    return None if focus in ("", GENERAL) else focus


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


def prepare_task(
    messages: list[BaseMessage],
    *,
    focus: str | None,
    thread_id: str | None,
    tool_call_id: str | None = None,
    taken: set[str] | frozenset[str] = frozenset(),
) -> tuple[str, str | None, str, list[BaseMessage]]:
    """Checks a `task` call and returns its sub-agent's label, focus, thread id and the
    thread's earlier turns. `taken` holds thread ids in use that the conversation doesn't
    show yet (background sub-agents still running)."""
    focus = focus_of({"subagent_type": focus})
    if focus and focus not in get_focuses():
        raise SubagentError(f"Unknown focus '{focus}'. Focuses: {', '.join(get_focuses())}.")
    if tool_call_id is not None:
        limit = settings.ASSISTANT_MAX_SUBAGENTS_PER_TURN
        if _task_ordinal(messages, tool_call_id) > limit:
            raise SubagentError(
                f"At most {limit} sub-agents per turn. Continue with what you have."
            )
    label = focus or GENERAL

    runs = subagent_runs(messages)
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
        if thread_id in taken:
            raise SubagentError(
                f"Sub-agent '{thread_id}' is still working in the background; its answer "
                "arrives on its own."
            )
        return label, focus, thread_id, thread_transcript(runs, thread_id)
    # Calls made together each get their own thread, as do background sub-agents running.
    used = {r.thread_id for r in runs if r.thread_id} | set(taken)
    ahead = _new_threads_ahead(messages, tool_call_id, label)
    n = 1
    while f"{label}-{n}" in used or ahead > 0:
        if f"{label}-{n}" not in used:
            ahead -= 1
        n += 1
    return label, focus, f"{label}-{n}", []


def _new_threads_ahead(messages: list[BaseMessage], tool_call_id: str | None, label: str) -> int:
    """How many new `label` threads the same model turn starts before this call."""
    if tool_call_id is None:
        return 0
    for message in reversed(messages):
        if not isinstance(message, AIMessage):
            continue
        calls = [c for c in message.tool_calls if c["name"] == "task"]
        if not any(c["id"] == tool_call_id for c in calls):
            continue
        ahead = 0
        for call in calls:
            if call["id"] == tool_call_id:
                return ahead
            args = call["args"]
            if not args.get("thread_id") and (focus_of(args) or GENERAL) == label:
                ahead += 1
    return 0


def _type_tasks(messages: list[BaseMessage]) -> None:
    """Gives each inline `task` call a `subagent_type`, even when the model left it out.

    ag-ui-langgraph knows a `task` call starts a sub-agent by `subagent_type` in the
    call; without it the sub-agent's stream isn't tied to its `task` card and isn't
    finished when the call returns. Background calls start no sub-agent stream."""
    for message in messages:
        if not isinstance(message, AIMessage):
            continue
        for call in message.tool_calls:
            if call["name"] == "task" and not call["args"].get("background"):
                call["args"]["subagent_type"] = focus_of(call["args"]) or GENERAL


def subagent_config(
    label: str, focus: str | None, thread_id: str, chat_focus: str | None
) -> RunnableConfig:
    """What a sub-agent's run adds to its parent's config."""
    return {
        "metadata": {"lc_agent_name": label},
        "run_name": f"subagent:{label}",
        "configurable": {
            "focus": focus,
            "assistant_subagent": True,
            # Marks the jobs it starts as its own, so their ends come back to it.
            "subagent_thread": thread_id,
            # The chat's own focus, for the main assistant's run when those jobs end.
            "chat_focus": chat_focus,
        },
    }


@tool
async def task(
    description: Annotated[
        str,
        "A specific, self-contained task. The sub-agent sees only this, never the conversation.",
    ],
    tool_call_id: Annotated[str, InjectedToolCallId],
    state: Annotated[dict[str, Any], InjectedState],
    config: RunnableConfig,
    subagent_type: Annotated[
        str | None,
        "The sub-agent's focus, from the list in your instructions. Omit for a general one.",
    ] = None,
    thread_id: Annotated[
        str | None,
        "To continue an earlier sub-agent, the thread_id from the end of its result. Omit to start fresh.",
    ] = None,
    background: Annotated[
        bool, "Run the sub-agent as a background job and return at once, for long work."
    ] = False,
) -> ToolMessage:
    """Start a copy of yourself with a fresh context, and return its final answer."""
    label, focus, thread_id, prior = prepare_task(
        state.get("messages", []),
        focus=subagent_type,
        thread_id=thread_id,
        tool_call_id=tool_call_id,
    )
    for message in prior:  # ids let this run's own messages be told apart afterwards
        message.id = message.id or str(uuid4())

    # The copy runs in this tool's checkpoint namespace with the parent's config,
    # so its events stream through the parent run, attributed by `lc_agent_name`.
    sub_config = merge_configs(
        config, subagent_config(label, focus, thread_id, _configurable(config).get("focus"))
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


# The model only ever calls `run`. `task` runs the `agent` commands it is turned into.
MODEL_TOOLS: list[BaseTool] = [run]
SUBAGENT_TOOLS: list[BaseTool] = [run]
MAIN_TOOLS: list[BaseTool] = [run, task]

_COMPACTION_MANAGER = CompactionManager()


def _model_runnable(
    model: BaseChatModel, tools: list[BaseTool], *, subagent: bool, bind_tools: bool
) -> RunnableSerializable[AssistantState, AIMessage]:
    bound = model.bind_tools(tools) if bind_tools else model

    def model_input(state: AssistantState, config: RunnableConfig) -> list[BaseMessage]:
        messages = normalize_messages_for_replay(list(state["messages"]))
        if not subagent:
            messages = tag_threads(messages)
        messages = for_model(messages)
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
    tools = SUBAGENT_TOOLS if subagent else MAIN_TOOLS
    with_tools = _model_runnable(model, MODEL_TOOLS, subagent=subagent, bind_tools=True)
    without_tools = _model_runnable(model, MODEL_TOOLS, subagent=subagent, bind_tools=False)

    async def acall_model(state: AssistantState, config: RunnableConfig) -> dict:
        messages = list(state["messages"])
        ended = [] if subagent else await bg.pending_events(messages, config)
        if not ended and not subagent and bg.awaiting_input(messages):
            return {}  # a follow-up run whose events another run already handled
        events = [bg.event_message(job) for job in ended]
        update = await run_tool_loop_turn(
            state=cast(AssistantState, {**state, "messages": [*messages, *events]}),
            config=config,
            summary_model=model,
            model_runnable_with_tools=with_tools,
            model_runnable_without_tools=without_tools,
            compaction_manager=_COMPACTION_MANAGER,
        )
        as_stored(update.get("messages", []), sub_agents=not subagent)
        _type_tasks(update.get("messages", []))
        if ended:
            await jobs.store().mark_notified([job.id for job in ended])
            update = {**update, "messages": [*events, *update.get("messages", [])]}
        return update

    graph = StateGraph(AssistantState)
    graph.add_node("model", acall_model)
    # Node name "tools" and one Send per tool call are what ag-ui-langgraph
    # relies on to attribute sub-agent events to their `task` call.
    errors = errors_as_results(lambda args: focus_of(args) or GENERAL)
    run_in_background = bg.background_jobs()

    async def wrap_tool_call(request: Any, execute: Any) -> Any:
        return await errors(request, lambda r: run_in_background(r, execute))

    graph.add_node("tools", ToolNode(tools, awrap_tool_call=wrap_tool_call))
    graph.set_entry_point("model")
    graph.add_edge("tools", "model")
    graph.add_conditional_edges("model", send_pending_tool_calls, ["tools", END])
    return graph.compile(name="assistant-subagent" if subagent else "assistant")


assistant = ConfigurableModelGraph(lambda model_name: _build(model_name, subagent=False))
assistant_subagent = ConfigurableModelGraph(lambda model_name: _build(model_name, subagent=True))
