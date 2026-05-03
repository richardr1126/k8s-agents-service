from datetime import datetime
from typing import Any, Literal, cast

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig, RunnableSerializable
from langgraph.graph import END, StateGraph
from langgraph.prebuilt import ToolNode

from agents.compaction import CompactionManager
from agents.tool_loop import (
    ToolLoopState,
    pending_tool_calls as pending_tool_calls_helper,
    run_tool_loop_turn,
    wrap_tool_loop_model,
)
from agents.workflow_tools import workflow_tools
from core import get_model, settings


class AgentState(ToolLoopState, total=False):
    pass


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


_COMPACTION_MANAGER = CompactionManager()


def wrap_model(model: BaseChatModel) -> RunnableSerializable[AgentState, AIMessage]:
    return _wrap_model(model, bind_tools=True)


def _wrap_model(
    model: BaseChatModel, *, bind_tools: bool
) -> RunnableSerializable[AgentState, AIMessage]:
    return cast(
        RunnableSerializable[AgentState, AIMessage],
        wrap_tool_loop_model(
            model,
            tools=cast(list[Any], workflow_tools),
            prompt=instructions,
            bind_tools=bind_tools,
            normalize_replay_messages=False,
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


agent = StateGraph(AgentState)
agent.add_node("model", acall_model)
agent.add_node("tools", ToolNode(workflow_tools))
agent.set_entry_point("model")
agent.add_edge("tools", "model")


def pending_tool_calls(state: AgentState) -> Literal["tools", "done"]:
    return pending_tool_calls_helper(state)


agent.add_conditional_edges("model", pending_tool_calls, {"tools": "tools", "done": END})

workflow_agent = agent.compile(name="workflow-agent")
