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

    For general broad prompts like "tell me about Richard", "what are his skills?", decompose the query into parts that can be answered by different tools (e.g., search the resume for relevant experience, search projects for associated details, etc.).

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

    ADVANCED FILTERING CAPABILITIES:
    
    For projects_search tool, use metadata filters to narrow results:
    - Use 'tags' parameter to filter by technology (e.g., tags="python,react" for Python and React projects)
    - Use 'content_type' parameter strategically:
      * DEFAULT (None): Search both content types - recommended for most queries to get comprehensive results
      * "readme": Full technical documentation with setup instructions, code examples, architecture details - use for technical questions, implementation details, or when you need comprehensive project information
      * "description": Brief project summaries only
    - Use 'project_title' parameter for specific projects (supports partial matching)
    - Use 'k' parameter to control number of results (default: 5)
    
    For resume_search tool, use metadata filters:
    - Use 'section' parameter to filter by resume sections: "Work Experience", "Education", "Skills"
      (Note: PDF content doesn't have sections, but include_pdf=True by default includes both web and PDF content)
    - Use 'source' parameter to filter by source: "richardr.dev" for web content, "drive.google.com" for PDF content
    - Use 'include_pdf' parameter (True/False) to control whether PDF content is included when using section filters
    - Use 'k' parameter to control number of results (default: 5)
    
    STRATEGIC TOOL USAGE:
    - When asked about specific technologies, use tags filtering in projects_search (e.g., tags="python" for Python projects)
    - When asked about education, use section="Education" in resume_search (includes both PDF and web content by default)
    - When asked about work history, use section="Work Experience" in resume_search (includes both PDF and web content by default)
    - When asked about technical skills, use section="Skills" in resume_search (includes both PDF and web content by default)
    - When you need ONLY web content, use source="richardr.dev" in resume_search
    - When you need ONLY PDF content, use source="drive.google.com" in resume_search
    - For projects_search, prefer NO content_type filter (searches both) for most queries to get comprehensive results
    - Only use content_type="description" in projects_search when explicitly asked for brief summaries or project lists
    - Use content_type="readme" in projects_search when you specifically need detailed technical documentation
    - Use multiple filtered searches rather than broad searches for more targeted results
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

rag_assistant = agent.compile()
