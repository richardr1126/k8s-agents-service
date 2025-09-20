from typing import Literal

from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, MessagesState, StateGraph
from langgraph.managed import RemainingSteps
from langgraph.prebuilt import ToolNode

from core import get_model, settings
from agents.tools import get_mcp_tools


class AgentState(MessagesState, total=False):
    """State for the React agent."""
    pass


async def acall_model(state: AgentState, config: RunnableConfig) -> AgentState:
    """Call the model with tools."""
    model = get_model(config["configurable"].get("model", settings.DEFAULT_MODEL))
    
    # Get MCP tools dynamically
    tools = await get_mcp_tools()
    
    # Bind tools to model
    bound_model = model.bind_tools(tools)
    
    # Call the model
    response = await bound_model.ainvoke(state["messages"], config)
    
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

react_agent = agent.compile(name="postgres-mcp-agent")