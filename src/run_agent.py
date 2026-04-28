import asyncio
from uuid import uuid4

from dotenv import load_dotenv
from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import MessagesState

load_dotenv()

from agents import (  # noqa: E402
    DEFAULT_AGENT,
    AgentGraph,
    get_agent,
    get_all_agent_info,
    load_agent,
)


async def main() -> None:
    for agent_info in get_all_agent_info():
        await load_agent(agent_info.key)

    agent: AgentGraph = get_agent(DEFAULT_AGENT)
    inputs: MessagesState = {
        "messages": [HumanMessage("Find me a recipe for chocolate chip cookies")]
    }
    result = await agent.ainvoke(  # type: ignore[arg-type]
        input=inputs,
        config=RunnableConfig(configurable={"thread_id": uuid4()}),
    )
    result["messages"][-1].pretty_print()

    # Draw the agent graph as png
    # requires:
    # brew install graphviz
    # export CFLAGS="-I $(brew --prefix graphviz)/include"
    # export LDFLAGS="-L $(brew --prefix graphviz)/lib"
    # pip install pygraphviz
    #
    # agent.get_graph().draw_png("agent_diagram.png")


if __name__ == "__main__":
    asyncio.run(main())
