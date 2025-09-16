from datetime import datetime
from typing import Literal

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, SystemMessage
from langchain_core.runnables import (
    RunnableConfig,
    RunnableLambda,
    RunnableSerializable,
)
from langgraph.graph import END, MessagesState, StateGraph
from langgraph.managed import RemainingSteps
from langgraph.prebuilt import ToolNode

from agents.tools import projects_search, resume_search
from core import get_model, settings


class AgentState(MessagesState, total=False):
    """`total=False` is PEP589 specs.

    documentation: https://typing.readthedocs.io/en/latest/spec/typeddict.html#totality
    """

    remaining_steps: RemainingSteps


tools = [projects_search, resume_search]


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
    bound_model = model.bind_tools(tools)
    preprocessor = RunnableLambda(
        lambda state: [SystemMessage(content=instructions)] + state["messages"],
        name="StateModifier",
    )
    return preprocessor | bound_model  # type: ignore[return-value]


async def acall_model(state: AgentState, config: RunnableConfig) -> AgentState:
    m = get_model(config["configurable"].get("model", settings.DEFAULT_MODEL))
    model_runnable = wrap_model(m)
    response = await model_runnable.ainvoke(state, config)

    if state["remaining_steps"] < 10 and response.tool_calls:
        return {
            "messages": [
                AIMessage(
                    id=response.id,
                    content="Sorry, need more steps to process this request.",
                )
            ]
        }
    # We return a list, because this will get added to the existing list
    return {"messages": [response]}

# Define the graph
agent = StateGraph(AgentState)
agent.add_node("model", acall_model)
agent.add_node("tools", ToolNode(tools))
agent.set_entry_point("model")

# Always run "model" after "tools"
agent.add_edge("tools", "model")


# After "model", if there are tool calls, run "tools". Otherwise END.
def pending_tool_calls(state: AgentState) -> Literal["tools", "done"]:
    last_message = state["messages"][-1]
    if not isinstance(last_message, AIMessage):
        raise TypeError(f"Expected AIMessage, got {type(last_message)}")
    if last_message.tool_calls:
        return "tools"
    return "done"


agent.add_conditional_edges("model", pending_tool_calls, {"tools": "tools", "done": END})

rag_assistant = agent.compile(name="resume-agent")
