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

from core import get_model, settings
from agents.tools import get_mcp_tools


class AgentState(MessagesState, total=False):
    """State for the MCP agent."""
    remaining_steps: RemainingSteps


current_date = datetime.now().strftime("%B %d, %Y")
instructions = f"""
    You are a specialized database analyst for the Cosmere Feed - a custom Bluesky feed featuring content related to Brandon Sanderson's Cosmere series.
    You have access to a PostgreSQL database through MCP tools that contains data about this specialized social media feed.

    Today's date is {current_date}.

    Database Schema:
    - `requests` table: Tracks requests to the feed by user DID (Decentralized Identifier)
        - id: int4, not null (Primary Key)
        - indexed_at: timestamp, not null 
        - did: varchar(255), null
    
    - `post` table: Contains posts that appear on the Cosmere feed with a trending score (which decays after 24 hours)
        - id: int4, not null (Primary Key)
        - uri: varchar(255), not null
        - cid: varchar(255), not null
        - reply_parent: varchar(255), null
        - reply_root: varchar(255), null
        - indexed_at: timestamp, not null
        - author: varchar(255), null
        - interactions: int8, not null (trending score that decays after 24 hours)
        - text: text, null

    Your primary functions:
    - Analyze feed usage patterns and user engagement
    - Explore post content and trends related to Cosmere/Brandon Sanderson content
    - Generate insights about the feed's performance and user behavior
    - Answer questions about feed data using SQL queries and data analysis
    - Identify popular content, active users, and engagement metrics; but REMEMBER the `interactions` score decays after 24 hours

    When responding to queries:
    - REMEMBER THE `interactions` SCORE DECAYS AFTER 24 HOURS, so either focus on recent data or adjust analysis to not focus on this metric
    - Create a todo list of analysis steps if need to fully answer a question/query
    - Use PostgreSQL tools to explore and query the database
    - Provide data-driven insights with specific numbers and trends
    - Explain your analysis methodology and findings clearly
    - Be proactive in exploring related data to provide comprehensive answers
    - Consider both technical metrics and content-related patterns
    - Break down complex analyses into logical steps; and use CTEs (Common Table Expressions) to structure complex queries for more complex analysis

    REMEMBER: This is Cosmere/Brandon Sanderson fan content, so context about the fantasy series may be relevant to understanding user behavior and content patterns.
    """


async def wrap_model(model: BaseChatModel, tools: list) -> RunnableSerializable[AgentState, AIMessage]:
    """Wrap model with tools and system instructions."""
    bound_model = model.bind_tools(tools)
    preprocessor = RunnableLambda(
        lambda state: [SystemMessage(content=instructions)] + state["messages"],
        name="StateModifier",
    )
    return preprocessor | bound_model  # type: ignore[return-value]


async def acall_model(state: AgentState, config: RunnableConfig) -> AgentState:
    """Call the model with tools."""
    model = get_model(config["configurable"].get("model", settings.DEFAULT_MODEL))
    
    # Get MCP tools dynamically
    tools = await get_mcp_tools()
    
    # Wrap model with system instructions and tools
    model_runnable = await wrap_model(model, tools)
    
    # Call the model
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
    
    return {"messages": [response]}


async def acall_tools(state: AgentState, config: RunnableConfig) -> AgentState:
    """Call tools dynamically."""
    tools = await get_mcp_tools()
    tool_node = ToolNode(tools)
    return await tool_node.ainvoke(state, config)


def pending_tool_calls(state: AgentState) -> Literal["tools", "done"]:
    """Check if there are pending tool calls."""
    last_message = state["messages"][-1]
    if not isinstance(last_message, AIMessage):
        raise TypeError(f"Expected AIMessage, got {type(last_message)}")
    if last_message.tool_calls:
        return "tools"
    return "done"


# Define the graph
agent = StateGraph(AgentState)
agent.add_node("model", acall_model)
agent.add_node("tools", acall_tools)
agent.set_entry_point("model")

# Always run "model" after "tools"
agent.add_edge("tools", "model")

# After "model", if there are tool calls, run "tools". Otherwise END.
agent.add_conditional_edges("model", pending_tool_calls, {"tools": "tools", "done": END})

mcp_agent = agent.compile(name="postgres-mcp-agent")