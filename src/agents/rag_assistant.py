from datetime import datetime
from typing import Any, Literal, cast

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.runnables import (
    RunnableConfig,
    RunnableSerializable,
)
from langgraph.graph import END, StateGraph
from langgraph.prebuilt import ToolNode

from agents.compaction import CompactionManager
from agents.tools import projects_search, resume_search
from agents.tool_loop import (
    ToolLoopState,
    pending_tool_calls as pending_tool_calls_helper,
    run_tool_loop_turn,
    wrap_tool_loop_model,
)
from core import get_model, settings


class AgentState(ToolLoopState, total=False):
    """`total=False` is PEP589 specs.

    documentation: https://typing.readthedocs.io/en/latest/spec/typeddict.html#totality
    """

    pass


tools = [projects_search, resume_search]
_COMPACTION_MANAGER = CompactionManager()


current_date = datetime.now().strftime("%B %d, %Y")
instructions = f"""
    You are a professional resume assistant designed to help showcase skills, experience, and accomplishments. And tool calling machine.
    Your primary function is to break down user queries into actionable components and perform multiple tool calls to provide comprehensive answers about professional background, technical skills, work experience, and project achievements.

    For general broad prompts like "tell me about Richard", "what are his skills?", decompose the query into parts that can be answered by different tools (e.g., search the resume for relevant experience, search projects for associated details, etc.). USE AT LEAST 5 SEARCHES IN THESE BROAD QUERIES.

    Today's date is {current_date}.

    When responding to queries about professional background:
    - Highlight relevant skills and experience
    - Provide specific examples of projects and achievements
    - Focus on quantifiable results when available
    - Present information in a professional, concise manner
    - Draw connections between different experiences and skills

    When using tools for information remember:
    - Broad user queries require multiple tool calls
    - Each search returns only a fraction of the full content inside these tools
    - Search queries need to be optimized to the content expected to be returned. Vector search works this way.
    - Be prepared to iterate and refine your approach based on the responses you receive from these tools
    """


def wrap_model(model: BaseChatModel) -> RunnableSerializable[AgentState, AIMessage]:
    return _wrap_model(model, bind_tools=True)


def _wrap_model(
    model: BaseChatModel, *, bind_tools: bool
) -> RunnableSerializable[AgentState, AIMessage]:
    return cast(
        RunnableSerializable[AgentState, AIMessage],
        wrap_tool_loop_model(
            model,
            tools=cast(list[Any], tools),
            prompt=instructions,
            bind_tools=bind_tools,
            normalize_replay_messages=True,
        ),
    )


async def acall_model(state: AgentState, config: RunnableConfig) -> AgentState:
    m = get_model(config["configurable"].get("model", settings.DEFAULT_MODEL))
    model_runnable = _wrap_model(m, bind_tools=True)
    model_runnable_no_tools = _wrap_model(m, bind_tools=False)

    return cast(
        AgentState,
        await run_tool_loop_turn(
            state=state,
            config=config,
            summary_model=m,
            model_runnable_with_tools=model_runnable,
            model_runnable_without_tools=model_runnable_no_tools,
            compaction_manager=_COMPACTION_MANAGER,
        ),
    )

# Define the graph
agent = StateGraph(AgentState)
agent.add_node("model", acall_model)
agent.add_node("tools", ToolNode(tools))
agent.set_entry_point("model")

# Always run "model" after "tools"
agent.add_edge("tools", "model")


# After "model", if there are tool calls, run "tools". Otherwise END.
def pending_tool_calls(state: AgentState) -> Literal["tools", "done"]:
    return pending_tool_calls_helper(state)


agent.add_conditional_edges("model", pending_tool_calls, {"tools": "tools", "done": END})

rag_assistant = agent.compile(name="resume-agent")
