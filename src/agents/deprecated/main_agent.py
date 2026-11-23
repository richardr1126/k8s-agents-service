"""Main router agent that dispatches work to sub-agents via a single `task` tool.

Pattern inspired by LangChain's `deepagents`: the main ReAct agent decides
which specialized sub-agent to invoke and writes the sub-task description
itself. Each sub-agent returns its final answer to the main agent as a
ToolMessage whose artifact keeps the sub-agent's messages for history reload.
"""

from datetime import datetime
from typing import Annotated, Any, Literal, cast
from uuid import uuid4

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    ToolMessage,
    messages_to_dict,
)
from langchain_core.runnables import RunnableConfig, RunnableSerializable
from langchain_core.runnables.config import merge_configs
from langchain_core.tools import InjectedToolCallId, tool
from langgraph.errors import GraphBubbleUp
from langgraph.graph import END, StateGraph
from langgraph.prebuilt import InjectedState, ToolNode

from agents.compaction import CompactionManager
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
from agents.deprecated.rag_assistant import rag_assistant
from agents.deprecated.web_rag_agent import web_rag_agent
from agents.tool_loop import (
    ToolLoopState,
    run_tool_loop_turn,
    send_pending_tool_calls,
    wrap_tool_loop_model,
)
from core import get_model
from schema.models import AllModelEnum

SubAgentType = Literal["resume", "web"]


MAIN_AGENT_PROMPT = """\
You are the auto-router on Richard's site. You answer by delegating to specialized sub-agents through the `task` tool, then reply to the user.

Sub-agents (`subagent_type`):
- "resume": Richard's professional background: skills, projects, work history, education. It searches his resume and project repositories.
- "web": live web research for current events, recent news, real-time data, or anything that needs up-to-date information.

How a task works:
- A sub-agent sees only the `description` you write, never the user's messages. Make it specific and self-contained, with any context it needs.
- Each task result ends with `[thread_id: ...]`, naming that sub-agent conversation (e.g. `resume-1`, `web-2`).
- Pass a `thread_id` back, with the same `subagent_type`, to continue that conversation. The sub-agent then remembers what it was asked, what it searched and what it answered, so your description can say "of those", "the second project" or "go deeper on X" without repeating everything.
- Omit `thread_id` to start a new conversation.

Choosing a thread:
- Continue a thread when the user follows up on something a sub-agent already covered: more detail, a narrower or related question, a comparison with its earlier answer.
- Start a new thread for a different subject, or when the earlier thread would only add noise.
- Use whichever thread fits; it need not be the latest one.

How to work:
1. Read the request and the conversation so far.
2. Pick the sub-agent(s). Independent parts can go to several sub-agents in parallel; dispatch one after another only when a later task needs an earlier answer.
3. Reply concisely from what the sub-agents returned. Quote or lightly summarize; don't add facts they didn't find.
4. Answer directly, without a task, only for small talk or questions about the conversation itself.

Thread ids are for you only; never mention them to the user.

Today's date is {current_date}.
"""


class MainAgentState(ToolLoopState, total=False):
    pass


def _resolve_sub_agent(subagent_type: str) -> Any:
    """Look up the sub-agent graph for a given subagent_type."""
    if subagent_type == "resume":
        return rag_assistant
    if subagent_type == "web":
        return web_rag_agent
    raise ValueError(f"Unknown subagent_type '{subagent_type}'. Must be one of: resume, web.")


@tool
async def task(
    description: Annotated[
        str,
        "A specific, self-contained task description for the sub-agent. "
        "Include all context the sub-agent needs — it cannot see the original conversation.",
    ],
    subagent_type: Annotated[
        SubAgentType,
        "Which sub-agent to dispatch to: 'resume' or 'web'.",
    ],
    tool_call_id: Annotated[str, InjectedToolCallId],
    state: Annotated[dict[str, Any], InjectedState],
    config: RunnableConfig,
    thread_id: Annotated[
        str | None,
        "To follow up on an earlier task, the thread_id from the end of its result; the "
        "sub-agent then remembers that conversation. Omit to start a new thread.",
    ] = None,
) -> ToolMessage:
    """Delegate a task to a specialized sub-agent and return its final answer."""
    # The sub-agent runs inside this tool's checkpoint namespace with the parent's
    # config, so its events stream through the parent run. ag-ui-langgraph
    # attributes them via `lc_agent_name` and uses the namespace as subagentRunId.
    sub_config = merge_configs(
        config,
        {"metadata": {"lc_agent_name": subagent_type}, "run_name": f"subagent:{subagent_type}"},
    )
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
        if thread[0].subagent_type != subagent_type:
            raise SubagentError(
                f"Thread '{thread_id}' belongs to the '{thread[0].subagent_type}' sub-agent, "
                f"not '{subagent_type}'."
            )
        prior = thread_transcript(runs, thread_id)
    else:
        thread_id = new_thread_id(runs, subagent_type)
        prior = []
    for message in prior:  # ids let this run's own messages be told apart afterwards
        message.id = message.id or str(uuid4())
    try:
        sub_agent = _resolve_sub_agent(subagent_type)
        result = await sub_agent.ainvoke(
            {"messages": [*prior, HumanMessage(content=description)]}, sub_config
        )
    except GraphBubbleUp:
        raise
    except Exception as e:
        raise SubagentError(f"Sub-agent '{subagent_type}' failed: {e}") from e

    messages = result["messages"]
    # Only this run's messages are stored; earlier turns live on the runs they came from.
    seen = {m.id for m in prior if m.id}
    own = [m for m in messages if not isinstance(m, HumanMessage) and m.id not in seen]
    return task_result(
        tool_call_id,
        config["configurable"]["checkpoint_ns"],
        subagent_type,
        description,
        normalize_content(messages[-1].content),
        thread_id=thread_id,
        messages=messages_to_dict(own),
    )


_TOOLS = [task]
_COMPACTION_MANAGER = CompactionManager()


def wrap_model(
    model: BaseChatModel, *, bind_tools: bool = True
) -> RunnableSerializable[MainAgentState, AIMessage]:
    current_date = datetime.now().strftime("%B %d, %Y")
    system_prompt = MAIN_AGENT_PROMPT.format(current_date=current_date)
    return cast(
        RunnableSerializable[MainAgentState, AIMessage],
        wrap_tool_loop_model(
            model,
            tools=cast(list[Any], _TOOLS),
            prompt=system_prompt,
            bind_tools=bind_tools,
            normalize_replay_messages=True,
            prepare_messages=tag_threads,
        ),
    )


def _build_main_graph(model_name: AllModelEnum):
    model = get_model(model_name)
    model_runnable = wrap_model(model, bind_tools=True)
    model_runnable_no_tools = wrap_model(model, bind_tools=False)

    async def acall_model(state: MainAgentState, config: RunnableConfig) -> dict:
        return await run_tool_loop_turn(
            state=state,
            config=config,
            summary_model=model,
            model_runnable_with_tools=model_runnable,
            model_runnable_without_tools=model_runnable_no_tools,
            compaction_manager=_COMPACTION_MANAGER,
        )

    graph = StateGraph(MainAgentState)
    graph.add_node("model", acall_model)
    # Node name "tools" and one Send per tool call are what ag-ui-langgraph
    # relies on to attribute sub-agent events to their `task` call.
    graph.add_node("tools", ToolNode(_TOOLS, awrap_tool_call=errors_as_results(lambda args: args["subagent_type"])))
    graph.set_entry_point("model")
    graph.add_edge("tools", "model")
    graph.add_conditional_edges("model", send_pending_tool_calls, ["tools", END])
    return graph.compile(name="main-agent")


main_agent = ConfigurableModelGraph(_build_main_graph)
