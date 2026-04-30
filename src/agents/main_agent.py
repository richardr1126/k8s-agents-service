"""Main router agent that dispatches work to sub-agents via a single `task` tool.

Pattern inspired by LangChain's `deepagents`: the main ReAct agent decides
which specialized sub-agent to invoke and writes the sub-task description
itself. Sub-agents run in isolation and return a single string back to the
main agent as a ToolMessage.
"""

from datetime import datetime
import json
import logging
from typing import Any, Literal, cast
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, SystemMessage, ToolMessage
from langchain_core.runnables import (
    RunnableConfig,
    RunnableLambda,
    RunnableSerializable,
)
from langchain_core.tools import InjectedToolCallId, tool
from langgraph.graph import END, MessagesState, StateGraph
from langgraph.managed import RemainingSteps
from langgraph.prebuilt import InjectedState, ToolNode
from langgraph.types import Command
from typing_extensions import Annotated

from agents.configurable_model_graph import ConfigurableModelGraph
from agents.mcp_agent import mcp_agent
from agents.rag_assistant import rag_assistant
from agents.web_rag_agent import web_rag_agent
from core import get_model, settings
from schema.models import AllModelEnum
from service.utils import normalize_messages_for_replay

SubAgentType = Literal["resume", "web", "postgres"]
logger = logging.getLogger(__name__)


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
- "postgres": Analyzes the Cosmere Feed PostgreSQL database (user metrics, content trends, engagement insights for a Bluesky feed featuring Brandon Sanderson's Cosmere content).

How to work:
1. Read the user's request.
2. Pick the most appropriate sub-agent.
3. Call the `task` tool with a clear, specific `description` that fully captures what that sub-agent should do. The sub-agent does NOT see the user's original message — it only sees your description, so include any necessary context.
4. When the sub-agent returns, either:
   - Pass its answer back to the user (you may quote or lightly summarize it), OR
   - If the user's question requires multiple sub-agents, dispatch the next one.
5. Be concise in your final reply — the sub-agent has already done the substantive work.

Today's date is {current_date}.
"""


class MainAgentState(MessagesState, total=False):
    remaining_steps: RemainingSteps


def _resolve_sub_agent(subagent_type: str) -> Any:
    """Look up the sub-agent graph for a given subagent_type."""
    if subagent_type == "resume":
        return rag_assistant
    if subagent_type == "web":
        return web_rag_agent
    if subagent_type == "postgres":
        # mcp_agent is lazy-loaded; .get_graph() returns a ConfigurableModelGraph
        # that respects config["configurable"]["model"].
        return mcp_agent.get_graph()
    raise ValueError(
        f"Unknown subagent_type '{subagent_type}'. Must be one of: resume, web, postgres."
    )


def _child_run_id(parent_run_id: Any, branch_id: str) -> UUID:
    """Derive a deterministic child run id for a branch under a parent run."""
    if parent_run_id is None:
        return uuid4()
    return uuid5(NAMESPACE_URL, f"{parent_run_id}:{branch_id}")


def _subagent_config_for_branch(
    parent_config: RunnableConfig, *, subagent_type: SubAgentType, tool_call_id: str
) -> RunnableConfig:
    """Build an isolated RunnableConfig for one parallel sub-agent branch.

    The key behavior here is thread isolation: each sub-agent call gets a unique
    derived `thread_id`, preventing checkpoint collisions across parallel calls.
    """
    parent_configurable = dict((parent_config or {}).get("configurable", {}))
    parent_thread_id = str(parent_configurable.get("thread_id") or "thread")
    branch_id = f"{subagent_type}:{tool_call_id}"
    branch_thread_id = f"{parent_thread_id}::subagent::{branch_id}"

    branch_configurable = {
        **parent_configurable,
        "parent_thread_id": parent_thread_id,
        "thread_id": branch_thread_id,
        "branch_id": branch_id,
        "subagent_type": subagent_type,
        "subagent_call_id": tool_call_id,
    }

    tags = [*(parent_config.get("tags") or [])]
    for tag in (
        "subagent-call",
        f"subagent:{subagent_type}",
        f"branch:{branch_id}",
    ):
        if tag not in tags:
            tags.append(tag)

    metadata = dict(parent_config.get("metadata") or {})
    metadata.update(
        {
            "parent_thread_id": parent_thread_id,
            "branch_thread_id": branch_thread_id,
            "branch_id": branch_id,
            "subagent_type": subagent_type,
            "subagent_call_id": tool_call_id,
        }
    )

    return RunnableConfig(
        configurable=branch_configurable,
        run_id=_child_run_id(parent_config.get("run_id"), branch_id),
        callbacks=parent_config.get("callbacks"),
        tags=tags,
        metadata=metadata,
        max_concurrency=parent_config.get("max_concurrency"),
        recursion_limit=parent_config.get("recursion_limit"),
        run_name=f"subagent:{subagent_type}",
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
        "Which sub-agent to dispatch to: 'resume', 'web', or 'postgres'.",
    ],
    state: Annotated[dict, InjectedState],
    tool_call_id: Annotated[str, InjectedToolCallId],
    config: RunnableConfig,
) -> Command:
    """Delegate a task to a specialized sub-agent and return its final answer."""
    sub_agent = _resolve_sub_agent(subagent_type)
    subagent_config = _subagent_config_for_branch(
        config,
        subagent_type=subagent_type,
        tool_call_id=tool_call_id,
    )
    branch_id = f"{subagent_type}:{tool_call_id}"
    if settings.PARALLEL_BRANCH_DEBUG:
        logger.info(
            "subagent.start branch_id=%s subagent=%s parent_thread=%s branch_thread=%s",
            branch_id,
            subagent_type,
            (config.get("configurable") or {}).get("thread_id"),
            (subagent_config.get("configurable") or {}).get("thread_id"),
        )
    result = await sub_agent.ainvoke(
        {"messages": [("user", description)]},
        config=subagent_config,
    )
    final_message = result["messages"][-1]
    raw_content = (
        final_message.content
        if hasattr(final_message, "content")
        else final_message
    )
    content = _normalize_tool_result_content(raw_content)
    if settings.PARALLEL_BRANCH_DEBUG:
        logger.info(
            "subagent.complete branch_id=%s subagent=%s tool_call_id=%s",
            branch_id,
            subagent_type,
            tool_call_id,
        )

    return Command(
        update={
            "messages": [
                ToolMessage(
                    content=content,
                    name=f"task:{subagent_type}",
                    tool_call_id=tool_call_id,
                    artifact={
                        "branch_id": branch_id,
                        "subagent_type": subagent_type,
                        "subagent_call_id": tool_call_id,
                    },
                )
            ]
        }
    )


_TOOLS = [task]


def wrap_model(model: BaseChatModel) -> RunnableSerializable[MainAgentState, AIMessage]:
    bound_model = model.bind_tools(_TOOLS)
    current_date = datetime.now().strftime("%B %d, %Y")
    system_prompt = MAIN_AGENT_PROMPT.format(current_date=current_date)
    preprocessor = RunnableLambda(
        lambda state: [SystemMessage(content=system_prompt)]
        + normalize_messages_for_replay(state["messages"]),
        name="StateModifier",
    )
    return preprocessor | bound_model  # type: ignore[return-value]


def pending_tool_calls(state: MainAgentState) -> Literal["tools", "done"]:
    last_message = state["messages"][-1]
    if not isinstance(last_message, AIMessage):
        raise TypeError(f"Expected AIMessage, got {type(last_message)}")
    if last_message.tool_calls:
        return "tools"
    return "done"


def _build_main_graph(model_name: AllModelEnum):
    model = get_model(model_name)
    model_runnable = wrap_model(model)

    async def acall_model(state: MainAgentState, config: RunnableConfig) -> dict:
        response = cast(AIMessage, await model_runnable.ainvoke(state, config))
        if state.get("remaining_steps", 100) < 10 and response.tool_calls:
            return {
                "messages": [
                    AIMessage(
                        id=response.id,
                        content="Sorry, need more steps to process this request.",
                    )
                ]
            }
        return {"messages": [response]}

    graph = StateGraph(MainAgentState)
    graph.add_node("model", acall_model)
    graph.add_node("tools", ToolNode(_TOOLS))
    graph.set_entry_point("model")
    graph.add_edge("tools", "model")
    graph.add_conditional_edges(
        "model", pending_tool_calls, {"tools": "tools", "done": END}
    )
    return graph.compile(name="main-agent")


main_agent = ConfigurableModelGraph(_build_main_graph)
