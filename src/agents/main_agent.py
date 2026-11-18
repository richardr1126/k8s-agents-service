"""Main router agent that dispatches work to sub-agents via a single `task` tool.

Pattern inspired by LangChain's `deepagents`: the main ReAct agent decides
which specialized sub-agent to invoke and writes the sub-task description
itself. Each sub-agent returns its final answer to the main agent as a
ToolMessage whose artifact keeps the sub-agent's messages for history reload.
"""

import json
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Annotated, Any, Literal, cast
from uuid import uuid4

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    ToolMessage,
    messages_from_dict,
    messages_to_dict,
)
from langchain_core.runnables import RunnableConfig, RunnableSerializable
from langchain_core.runnables.config import merge_configs
from langchain_core.tools import InjectedToolCallId, tool
from langgraph.errors import GraphBubbleUp
from langgraph.graph import END, StateGraph
from langgraph.prebuilt import InjectedState, ToolNode
from langgraph.prebuilt.tool_node import ToolCallRequest

from agents.compaction import CompactionManager
from agents.configurable_model_graph import ConfigurableModelGraph
from agents.rag_assistant import rag_assistant
from agents.tool_loop import (
    ToolLoopState,
    run_tool_loop_turn,
    send_pending_tool_calls,
    wrap_tool_loop_model,
)
from agents.web_rag_agent import web_rag_agent
from core import get_model
from schema.models import AllModelEnum
from schema.subagent import SubagentArtifact

SubAgentType = Literal["resume", "web"]


def _normalize_tool_result_content(value: Any) -> str:
    """Normalize arbitrary sub-agent message content into plain text."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = [_normalize_tool_result_content(item) for item in value]
        return "".join(part for part in parts if part)
    if isinstance(value, dict):
        # Skip non-text blocks such as Claude's "thinking" or "reasoning" blocks.
        if value.get("type") not in (None, "text"):
            return ""
        if isinstance(value.get("text"), str):
            return value["text"]
        if "content" in value:
            return _normalize_tool_result_content(value["content"])
        try:
            return json.dumps(value, ensure_ascii=False)
        except Exception:
            return str(value)
    return str(value)


MAIN_AGENT_PROMPT = """\
You are the main controller agent. You delegate work to specialized sub-agents through a single `task` tool.

Available sub-agents (subagent_type values):
- "resume": Answers questions about Richard's professional background, skills, projects, education, and career history.
- "web": Performs live web research for current events, recent news, real-time data, or anything requiring up-to-date information.

How to work:
1. Read the user's request.
2. Pick the most appropriate sub-agent.
3. Call the `task` tool with a clear, specific `description` that fully captures what that sub-agent should do. The sub-agent does NOT see the user's original message — it only sees your description, so include any necessary context.
   - Every task result ends with `[thread_id: ...]`. For a follow-up to something a sub-agent already worked on (digging deeper, a related question, "what about X?"), pass that `thread_id` with the same `subagent_type`. The sub-agent then continues that conversation, remembering what it was asked, what it found and what it answered, so your description can build on it. Omit `thread_id` to start a new thread for an unrelated task. Thread ids are for you only; never mention them to the user.
4. When the sub-agent returns, either:
   - Pass its answer back to the user (you may quote or lightly summarize it), OR
   - If the user's question requires multiple sub-agents, dispatch the next one.
5. Be concise in your final reply — the sub-agent has already done the substantive work.

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


THREAD_TAG = "thread_id"


def _subagent_runs(messages: list[BaseMessage]) -> list[SubagentArtifact]:
    """Every sub-agent run recorded on the conversation's `task` results, oldest first."""
    runs = []
    for message in messages:
        artifact = getattr(message, "artifact", None)
        if (
            isinstance(message, ToolMessage)
            and message.name == "task"
            and isinstance(artifact, dict)
            and artifact.get("type") == "subagent_run"
        ):
            runs.append(SubagentArtifact.model_validate(artifact))
    return runs


def _new_thread_id(runs: list[SubagentArtifact], subagent_type: str) -> str:
    """Short, readable ids (`web-1`, `resume-2`) that models copy back reliably."""
    used = {r.thread_id for r in runs if r.thread_id}
    n = 1
    while f"{subagent_type}-{n}" in used:
        n += 1
    return f"{subagent_type}-{n}"


def _thread_transcript(runs: list[SubagentArtifact], thread_id: str) -> list[BaseMessage]:
    """The thread's earlier turns: each run's task, then what the sub-agent did and said."""
    transcript: list[BaseMessage] = []
    for run in runs:
        if run.thread_id != thread_id or run.status != "success":
            continue
        transcript.append(HumanMessage(content=run.description))
        transcript.extend(
            m for m in messages_from_dict(run.messages) if not isinstance(m, HumanMessage)
        )
    return transcript


def _with_thread_tag(answer: str, thread_id: str) -> str:
    return f"{answer}\n\n[{THREAD_TAG}: {thread_id}]"


def _tag_threads(messages: list[BaseMessage]) -> list[BaseMessage]:
    """Show the model each task result's thread_id. Stored and streamed results stay clean."""
    out: list[BaseMessage] = []
    for message in messages:
        artifact = getattr(message, "artifact", None)
        thread_id = artifact.get("thread_id") if isinstance(artifact, dict) else None
        if isinstance(message, ToolMessage) and message.name == "task" and thread_id:
            text = _normalize_tool_result_content(message.content)
            message = message.model_copy(update={"content": _with_thread_tag(text, thread_id)})
        out.append(message)
    return out


class SubagentError(Exception):
    """A sub-agent failed; the parent gets an error result and carries on."""


def _task_result(
    tool_call_id: str, run_id: str, args: dict[str, Any], content: str, **artifact: Any
) -> ToolMessage:
    return ToolMessage(
        # The adapter streams TOOL_CALL_RESULT with this id; reusing the call id
        # keeps the live stream, the checkpoint and /history in agreement.
        id=tool_call_id,
        name="task",
        tool_call_id=tool_call_id,
        content=content,
        artifact=SubagentArtifact(
            subagent_run_id=run_id,
            subagent_type=args["subagent_type"],
            description=args["description"],
            **artifact,
        ).model_dump(),
    )


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
    runs = _subagent_runs(state.get("messages", []))
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
        prior = _thread_transcript(runs, thread_id)
    else:
        thread_id = _new_thread_id(runs, subagent_type)
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
    return _task_result(
        tool_call_id,
        config["configurable"]["checkpoint_ns"],
        {"subagent_type": subagent_type, "description": description},
        _normalize_tool_result_content(messages[-1].content),
        thread_id=thread_id,
        messages=messages_to_dict(own),
    )


async def _task_errors_as_results(
    request: ToolCallRequest, execute: Callable[[ToolCallRequest], Awaitable[Any]]
) -> Any:
    """Return a failed sub-agent to the parent model as an error result.

    The tool still raises, so the adapter emits SUBAGENT_ERROR; other errors
    propagate and end the run.
    """
    try:
        return await execute(request)
    except SubagentError as e:
        call = request.tool_call
        message = _task_result(
            cast(str, call["id"]),  # ToolNode only runs calls that have an id
            request.runtime.config["configurable"]["checkpoint_ns"],
            call["args"],
            str(e),
            status="error",
            error=str(e),
        )
        message.status = "error"
        return message


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
            prepare_messages=_tag_threads,
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
    graph.add_node("tools", ToolNode(_TOOLS, awrap_tool_call=_task_errors_as_results))
    graph.set_entry_point("model")
    graph.add_edge("tools", "model")
    graph.add_conditional_edges("model", send_pending_tool_calls, ["tools", END])
    return graph.compile(name="main-agent")


main_agent = ConfigurableModelGraph(_build_main_graph)
