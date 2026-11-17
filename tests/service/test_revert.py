import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, MessagesState, StateGraph

from service.revert import RevertError, revert_thread


def _graph():
    def reply(state: MessagesState):
        return {"messages": [AIMessage(content=f"echo {state['messages'][-1].content}")]}

    builder = StateGraph(MessagesState)
    builder.add_node("reply", reply)
    builder.add_edge(START, "reply")
    return builder.compile(checkpointer=InMemorySaver())


CONFIG = {"configurable": {"thread_id": "t1"}}


async def _say(graph, text: str, message_id: str) -> None:
    await graph.ainvoke({"messages": [HumanMessage(content=text, id=message_id)]}, CONFIG)


async def _contents(graph) -> list[str]:
    return [m.content for m in (await graph.aget_state(CONFIG)).values["messages"]]


@pytest.mark.asyncio
async def test_revert_forks_to_before_the_message():
    graph = _graph()
    await _say(graph, "one", "u1")
    await _say(graph, "two", "u2")
    await _say(graph, "three", "u3")

    assert await revert_thread(graph, "t1", "u2") == "two"
    assert await _contents(graph) == ["one", "echo one"]

    # The next run continues from the fork.
    await _say(graph, "again", "u4")
    assert await _contents(graph) == ["one", "echo one", "again", "echo again"]


@pytest.mark.asyncio
async def test_revert_first_message_clears_the_thread():
    graph = _graph()
    await _say(graph, "one", "u1")
    await _say(graph, "two", "u2")

    assert await revert_thread(graph, "t1", "u1") == "one"
    assert (await graph.aget_state(CONFIG)).values.get("messages", []) == []
    await _say(graph, "fresh", "u3")
    assert await _contents(graph) == ["fresh", "echo fresh"]


@pytest.mark.asyncio
async def test_revert_rejects_unknown_and_assistant_messages():
    graph = _graph()
    await _say(graph, "one", "u1")
    ai_id = (await graph.aget_state(CONFIG)).values["messages"][-1].id
    with pytest.raises(RevertError):
        await revert_thread(graph, "t1", "missing")
    with pytest.raises(RevertError):
        await revert_thread(graph, "t1", ai_id)
