from datetime import datetime
from typing import Literal

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, SystemMessage
from langchain_core.runnables import RunnableConfig, RunnableLambda, RunnableSerializable
from langgraph.graph import END, MessagesState, StateGraph
from langgraph.managed import RemainingSteps
from langgraph.prebuilt import ToolNode

from agents.workflow_tools import workflow_tools
from core import get_model, settings


class AgentState(MessagesState, total=False):
    remaining_steps: RemainingSteps


current_date = datetime.now().strftime("%B %d, %Y")
instructions = f"""You are a workflow-driven assistant. Today is {current_date}.

You have a small fixed tool surface that hides a larger library of pregenerated workflows:

- `list_capabilities`: list every workflow available, with a short summary card for each.
- `read_capability(capability_id)`: fetch the full usage docs (arguments, types, examples) for one workflow.
- `run_workflow_cli(command)`: execute a workflow. The `command` is one CLI-style string,
  e.g. `calculator "2 + 2"` or `some_workflow --flag value --other-flag=42 positional_value`.

When the user asks for something:

1. If you don't already know which workflow fits, call `list_capabilities` first.
2. Before invoking an unfamiliar workflow, call `read_capability` to learn its argument schema.
3. Then call `run_workflow_cli` with a properly-formatted command string. Quote string values
   that contain spaces. Boolean flags can be passed bare (`--verbose`) or with an explicit
   value (`--verbose true`). Use `--flag=value` or `--flag value`; short aliases like `-v` are
   also accepted when the workflow declares them.
4. If `run_workflow_cli` returns an error (e.g. unknown flag, missing required arg), re-read
   the capability docs, fix the command, and retry.

Do not invent workflows or arguments that aren't in the capability docs.
"""


def wrap_model(model: BaseChatModel) -> RunnableSerializable[AgentState, AIMessage]:
    bound_model = model.bind_tools(workflow_tools)
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
    return {"messages": [response]}


agent = StateGraph(AgentState)
agent.add_node("model", acall_model)
agent.add_node("tools", ToolNode(workflow_tools))
agent.set_entry_point("model")
agent.add_edge("tools", "model")


def pending_tool_calls(state: AgentState) -> Literal["tools", "done"]:
    last_message = state["messages"][-1]
    if not isinstance(last_message, AIMessage):
        raise TypeError(f"Expected AIMessage, got {type(last_message)}")
    if last_message.tool_calls:
        return "tools"
    return "done"


agent.add_conditional_edges("model", pending_tool_calls, {"tools": "tools", "done": END})

workflow_agent = agent.compile(name="workflow-agent")
