"""End-to-end tests of POST /{agent_id}/ag-ui, /history and DELETE /thread.

They run the real main agent, the real web agent and ag-ui-langgraph against
scripted chat models and an in-memory checkpointer (optionally a local
Postgres, see test_delete_thread_removes_all_namespaces).
"""

import json
import os
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from unittest.mock import patch

import agui_fakes
import httpx
import pytest
import pytest_asyncio
from agui_fakes import WEB_ANSWER, build_internal_call_graph, build_router
from langgraph.checkpoint.memory import InMemorySaver

import agents.deprecated.main_agent as main_agent
from agents.agents import DEFAULT_AGENT, Agent
from core import settings
from service import app

pytestmark = pytest.mark.asyncio

FIXTURE = Path(__file__).parent.parent / "fixtures" / "history_web_subagent.json"
# The assistant's live stream with two sub-agents, which the UI's tests replay.
STREAM_FIXTURE = Path(__file__).parent.parent / "fixtures" / "stream_assistant_subagents.json"
Events = list[dict[str, Any]]


@asynccontextmanager
async def serve(monkeypatch: pytest.MonkeyPatch, saver: Any) -> AsyncIterator[httpx.AsyncClient]:
    router = build_router(monkeypatch)
    router.checkpointer = saver
    internal = build_internal_call_graph()
    internal.checkpointer = saver
    test_agents = {
        DEFAULT_AGENT: Agent(description="router", graph=router),
        "internal": Agent(description="internal", graph=internal),
    }
    with (
        patch.dict("agents.agents.agents", test_agents),
        patch.dict("service.agui._prototypes", clear=True),
        patch.object(settings, "AVAILABLE_MODELS", {"fake"}),
        patch.object(settings, "AUTH_SECRET", None),
    ):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            yield c


@pytest.fixture
def saver() -> InMemorySaver:
    return InMemorySaver()


@pytest_asyncio.fixture
async def client(monkeypatch: pytest.MonkeyPatch, saver: Any) -> AsyncIterator[httpx.AsyncClient]:
    async with serve(monkeypatch, saver) as c:
        yield c


async def run(
    client: httpx.AsyncClient,
    messages: list[dict[str, Any]],
    *,
    thread_id: str = "thread-1",
    agent_id: str = DEFAULT_AGENT,
    **extra: Any,
) -> Events:
    body = {
        "threadId": thread_id,
        "runId": f"run-{len(messages)}-{bool(extra)}",
        "messages": messages,
        "forwardedProps": {"model": "fake", "user_id": "user-1"},
        **extra,
    }
    response = await client.post(f"/{agent_id}/ag-ui", json=body)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    return [
        json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")
    ]


def user(content: str, id: str = "user-1") -> dict[str, Any]:
    return {"id": id, "role": "user", "content": content}


def types(events: Events) -> list[str]:
    return [e["type"] for e in events]


def index(events: Events, type: str, **fields: Any) -> int:
    return next(
        i for i, e in enumerate(events) if e["type"] == type and fields.items() <= e.items()
    )


def index_args(events: Events, call_id: str) -> str:
    return "".join(
        e["delta"] for e in events if e["type"] == "TOOL_CALL_ARGS" and e["toolCallId"] == call_id
    )


def subagent_runs(events: Events) -> dict[str, dict[str, Any]]:
    """parentToolCallId -> SUBAGENT_STARTED event."""
    started = [e for e in events if e["type"] == "SUBAGENT_STARTED"]
    return {e["parentToolCallId"]: e for e in started}


def assert_closed_before_result(events: Events, run_id: str, call_id: str) -> None:
    closed = next(
        i
        for i, e in enumerate(events)
        if e["type"] in ("SUBAGENT_FINISHED", "SUBAGENT_ERROR") and e["subagentRunId"] == run_id
    )
    result = index(events, "TOOL_CALL_RESULT", toolCallId=call_id)
    assert closed < result
    assert "subagentRunId" not in events[result]


def assert_wire_hygiene(events: Events) -> None:
    assert "MESSAGES_SNAPSHOT" not in types(events)
    assert "RAW" not in types(events)
    assert all("rawEvent" not in e for e in events)


async def test_single_subagent_stream(client: httpx.AsyncClient) -> None:
    events = await run(client, [user("web:rust")])
    assert_wire_hygiene(events)
    assert types(events)[0] == "RUN_STARTED" and types(events)[-1] == "RUN_FINISHED"

    start = index(events, "TOOL_CALL_START", toolCallId="call_rust_1")
    assert events[start]["toolCallName"] == "task"
    args = events[index(events, "TOOL_CALL_ARGS", toolCallId="call_rust_1")]["delta"]
    assert json.loads(args) == {"description": "research rust", "subagent_type": "web"}

    assert types(events).count("SUBAGENT_STARTED") == 1
    started = subagent_runs(events)["call_rust_1"]
    assert started["name"] == "web"
    assert started["description"] == "research rust"
    run_id = started["subagentRunId"]
    assert run_id.startswith("tools:")
    assert index(events, "TOOL_CALL_END", toolCallId="call_rust_1") < events.index(started)

    # Everything between SUBAGENT_STARTED and SUBAGENT_FINISHED is the
    # sub-agent's and carries its run id; nothing outside does.
    first = events.index(started)
    last = index(events, "SUBAGENT_FINISHED", subagentRunId=run_id)
    for i, event in enumerate(events):
        if first < i < last:
            assert event.get("subagentRunId") == run_id, event
        elif i not in (first, last):
            assert "subagentRunId" not in event, event

    inner = events[first:last]
    search = next(e for e in inner if e["type"] == "TOOL_CALL_START")
    assert search["toolCallName"] == "web_search"
    assert "TOOL_CALL_RESULT" in types(inner)
    assert "".join(e["delta"] for e in inner if e["type"] == "TEXT_MESSAGE_CONTENT") == WEB_ANSWER

    assert_closed_before_result(events, run_id, "call_rust_1")
    assert (
        events[index(events, "TOOL_CALL_RESULT", toolCallId="call_rust_1")]["content"] == WEB_ANSWER
    )
    parent_text = [e["delta"] for e in events[last:] if e["type"] == "TEXT_MESSAGE_CONTENT"]
    assert "".join(parent_text) == f"Summary: {WEB_ANSWER}"
    assert agui_fakes.SEEN_THREAD_IDS[-1] == "web-1"


async def test_parallel_task_calls(client: httpx.AsyncClient) -> None:
    events = await run(client, [user("resume:alpha|web:rust")])
    assert_wire_hygiene(events)
    runs = subagent_runs(events)
    assert set(runs) == {"call_alpha_1", "call_rust_1"}
    assert runs["call_alpha_1"]["name"] == "resume"
    assert runs["call_rust_1"]["name"] == "web"
    alpha, rust = runs["call_alpha_1"]["subagentRunId"], runs["call_rust_1"]["subagentRunId"]
    assert alpha != rust

    expected = {
        "call_alpha_1": (alpha, "lookup", "Answer for alpha: facts about alpha"),
        "call_rust_1": (rust, "web_search", WEB_ANSWER),
    }
    for call_id, (run_id, tool_name, answer) in expected.items():
        tagged = [e for e in events if e.get("subagentRunId") == run_id]
        tools = [e["toolCallName"] for e in tagged if e["type"] == "TOOL_CALL_START"]
        assert tools == [tool_name]
        text = "".join(e["delta"] for e in tagged if e["type"] == "TEXT_MESSAGE_CONTENT")
        assert text == answer
        assert_closed_before_result(events, run_id, call_id)
        result = events[index(events, "TOOL_CALL_RESULT", toolCallId=call_id)]
        assert result["content"] == text


async def test_interrupt_and_resume(client: httpx.AsyncClient) -> None:
    events = await run(client, [user("resume:confirm")])
    assert_wire_hygiene(events)
    run_id = subagent_runs(events)["call_confirm_1"]["subagentRunId"]
    finished = events[index(events, "SUBAGENT_FINISHED", subagentRunId=run_id)]
    assert finished["outcome"]["type"] == "suspended"
    outcome = events[-1]["outcome"]
    assert events[-1]["type"] == "RUN_FINISHED" and outcome["type"] == "interrupt"
    [pending] = outcome["interrupts"]
    assert pending["subagentRunId"] == run_id
    assert finished["outcome"]["interruptIds"] == [pending["id"]]
    assert "TOOL_CALL_RESULT" not in [e["type"] for e in events if "subagentRunId" not in e]

    first_run = events
    # What a client holding the sub-agent card echoes back (as assistant-ui's
    # toAgUiMessages does): the sub-agent's calls flattened into the parent
    # assistant message, untagged.
    held_calls = [
        {
            "id": e["toolCallId"],
            "type": "function",
            "function": {"name": e["toolCallName"], "arguments": a},
        }
        for e in first_run
        if e["type"] == "TOOL_CALL_START"
        for a in [index_args(first_run, e["toolCallId"])]
    ]
    assert [c["id"] for c in held_calls] == ["call_confirm_1", "call_confirm_confirm"]
    echoed = [
        user("resume:confirm"),
        {"id": "main-dispatch-1", "role": "assistant", "content": "", "toolCalls": held_calls},
    ]
    resume = [{"interruptId": pending["id"], "status": "resolved", "payload": "yes"}]
    events = await run(client, echoed, resume=resume)
    assert_wire_hygiene(events)
    assert {e["subagentRunId"] for e in events if "subagentRunId" in e} == {run_id}
    # The resumed run continues the same card: calls the client holds are not
    # announced again, the sub-agent restarts under its original parent, and
    # results carry the first run's call ids.
    assert not [
        e for e in events if e["type"].startswith("TOOL_CALL_") and e["type"] != "TOOL_CALL_RESULT"
    ]
    [restarted] = [e for e in events if e["type"] == "SUBAGENT_STARTED"]
    first_started = subagent_runs(first_run)["call_confirm_1"]
    assert restarted == first_started
    assert first_started["parentMessageId"] == "main-dispatch-1"
    results = [e["toolCallId"] for e in events if e["type"] == "TOOL_CALL_RESULT"]
    assert results == ["call_confirm_confirm", "call_confirm_1"]
    assert (
        events[index(events, "TOOL_CALL_RESULT", toolCallId="call_confirm_confirm")]["content"]
        == "user said yes"
    )
    assert_closed_before_result(events, run_id, "call_confirm_1")
    result = events[index(events, "TOOL_CALL_RESULT", toolCallId="call_confirm_1")]
    assert result["content"] == "Answer for confirm: user said yes"
    assert events[-1]["type"] == "RUN_FINISHED"
    assert events[-1].get("outcome", {"type": "success"})["type"] == "success"


async def test_subagent_error_becomes_tool_result(client: httpx.AsyncClient) -> None:
    events = await run(client, [user("web:rust|resume:boom")])
    assert_wire_hygiene(events)
    run_id = subagent_runs(events)["call_boom_1"]["subagentRunId"]
    error = events[index(events, "SUBAGENT_ERROR", subagentRunId=run_id)]
    assert error["message"] == "Sub-agent 'resume' failed: search backend down"
    assert_closed_before_result(events, run_id, "call_boom_1")
    result = events[index(events, "TOOL_CALL_RESULT", toolCallId="call_boom_1")]
    assert result["content"] == error["message"]
    assert result["messageId"] == "call_boom_1"
    # The parent carries on with the error as the tool result.
    assert events[-1]["type"] == "RUN_FINISHED"
    assert "RUN_ERROR" not in types(events)

    history = (await client.post("/history", json={"thread_id": "thread-1"})).json()
    by_call = {s["parentToolCallId"]: s for s in history["subagents"]}
    assert by_call["call_boom_1"] == {
        "subagentRunId": run_id,
        "parentToolCallId": "call_boom_1",
        "name": "resume",
        "description": "research boom",
        "status": "error",
        "error": error["message"],
    }
    assert by_call["call_rust_1"]["status"] == "success"
    tool_message = next(m for m in history["messages"] if m["id"] == "call_boom_1")
    assert tool_message["error"] == "error"
    assert tool_message["content"] == error["message"]


async def test_uncaught_task_error_ends_run(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(_: Any) -> str:
        raise RuntimeError("bug in task")

    monkeypatch.setattr(main_agent, "normalize_content", broken)
    events = await run(client, [user("resume:alpha")])
    run_id = subagent_runs(events)["call_alpha_1"]["subagentRunId"]
    assert types(events)[-2:] == ["SUBAGENT_ERROR", "RUN_ERROR"]
    assert events[-2]["subagentRunId"] == run_id
    assert "TOOL_CALL_RESULT" not in [e["type"] for e in events if "subagentRunId" not in e]


def _normalize_ids(value: Any) -> Any:
    """Replace generated ids with stable placeholders, by order of appearance."""
    text = json.dumps(value, indent=2)
    seen: dict[str, str] = {}
    pattern = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|call_[0-9a-f]{32}"

    def placeholder(match: re.Match[str]) -> str:
        return seen.setdefault(match.group(0), f"<id-{len(seen) + 1}>")

    return json.loads(re.sub(pattern, placeholder, text))


def stream_shape(events: Events) -> dict[str, Any]:
    """Each stream's events in order: the main run's and each sub-agent's, by its `task` call.

    Parallel sub-agents interleave differently from run to run and finish in either order,
    so how their streams interleave, their results' order and snapshots aren't compared."""
    parents = {
        e["subagentRunId"]: e["parentToolCallId"] for e in events if e["type"] == "SUBAGENT_STARTED"
    }
    groups: dict[str, Events] = {}
    for e in events:
        if e["type"] == "STATE_SNAPSHOT":
            continue
        key = parents.get(e.get("subagentRunId"), "main")
        groups.setdefault(key, []).append({k: v for k, v in e.items() if k != "subagentRunId"})
    # Results come in the order their sub-agents finished: compared by call instead.
    main = groups.get("main", [])
    slots = [i for i, e in enumerate(main) if e["type"] == "TOOL_CALL_RESULT"]
    for i, e in zip(slots, sorted((main[i] for i in slots), key=lambda e: e["toolCallId"])):
        main[i] = e
    ordered = {key: groups[key] for key in sorted(groups)}
    # A recorded fixture's placeholders are renumbered like generated ids.
    text = re.sub(
        r"<id-(\d+)>",
        lambda m: f"{int(m.group(1)):08x}-0000-0000-0000-000000000000",
        json.dumps(ordered),
    )
    return _normalize_ids(json.loads(text))


def check_fixture(path: Path, value: Any) -> None:
    """`value` matches the fixture at `path`; with UPDATE_FIXTURES set, rewrites it."""
    if os.environ.get("UPDATE_FIXTURES"):
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps(value, indent=2) + "\n")
    assert value == json.loads(path.read_text())


async def test_history_matches_live_stream_and_fixture(client: httpx.AsyncClient) -> None:
    events = await run(client, [user("web:rust")])
    history = (await client.post("/history", json={"thread_id": "thread-1"})).json()

    run_id = subagent_runs(events)["call_rust_1"]["subagentRunId"]
    assert history["subagents"] == [
        {
            "subagentRunId": run_id,
            "parentToolCallId": "call_rust_1",
            "name": "web",
            "description": "research rust",
            "status": "success",
        }
    ]
    # Every streamed message and tool result is in history under the same id.
    streamed = {
        (e.get("subagentRunId"), e["messageId"])
        for e in events
        if e["type"] in ("TEXT_MESSAGE_START", "TOOL_CALL_RESULT")
    }
    stored = {(m.get("subagentRunId"), m["id"]) for m in history["messages"]}
    # A tool result has no message id until the checkpoint assigns one, so the
    # live event uses the tool call id; clients key tool results by toolCallId.
    live_results = {
        (e.get("subagentRunId"), e["toolCallId"]) for e in events if e["type"] == "TOOL_CALL_RESULT"
    }
    stored_results = {
        (m.get("subagentRunId"), m["toolCallId"])
        for m in history["messages"]
        if m["role"] == "tool"
    }
    assert live_results == stored_results
    assert streamed - stored <= live_results
    assert {(None, "call_rust_1"), (run_id, "web-answer")} <= streamed & stored
    assert [m["role"] for m in history["messages"] if "subagentRunId" not in m] == [
        "user",
        "assistant",
        "tool",
        "assistant",
    ]
    assert all(m["role"] != "user" for m in history["messages"] if "subagentRunId" in m)

    check_fixture(FIXTURE, _normalize_ids(history))


async def test_inbound_guard_keeps_echoed_subagent_messages_out(
    client: httpx.AsyncClient, saver: Any
) -> None:
    await run(client, [user("web:rust")])
    history = (await client.post("/history", json={"thread_id": "thread-1"})).json()
    sub_ids = {m["id"] for m in history["messages"] if "subagentRunId" in m}
    # A client that drops the tag echoes sub-agent messages as if they were the
    # parent's; one that keeps it is split out by the adapter.
    untagged = [{k: v for k, v in m.items() if k != "subagentRunId"} for m in history["messages"]]
    stray = {"id": "stray", "role": "assistant", "content": "made up"}
    echoed = [*untagged[:2], stray, *untagged[2:], user("resume:alpha", id="user-2")]

    events = await run(client, echoed)
    assert events[-1]["type"] == "RUN_FINISHED"
    state = await saver.aget_tuple({"configurable": {"thread_id": "thread-1", "checkpoint_ns": ""}})
    parent_ids = [m.id for m in state.checkpoint["channel_values"]["messages"]]
    assert not sub_ids & set(parent_ids)
    assert "stray" not in parent_ids
    assert parent_ids[:4] == [m["id"] for m in history["messages"] if "subagentRunId" not in m]
    assert parent_ids[4] == "user-2"


async def test_internal_llm_calls_are_not_streamed(client: httpx.AsyncClient) -> None:
    for agent_id, text in ((DEFAULT_AGENT, "web:rust"), ("internal", "hello")):
        events = await run(client, [user(text)], agent_id=agent_id, thread_id=agent_id)
        assert "INTERNAL" not in json.dumps([e for e in events if e["type"] != "STATE_SNAPSHOT"])
        streamed_ids = {e["messageId"] for e in events if e["type"] == "TEXT_MESSAGE_START"}
        assert not {i for i in streamed_ids if "internal" in i}
        tool_names = {e["toolCallName"] for e in events if e["type"] == "TOOL_CALL_START"}
        assert not tool_names & {"FirstRunSearchDecision", "SearchQuery", "RelevanceDecision"}
    assert streamed_ids == {"visible"}


async def _checkpoint_namespaces(saver: Any, thread_id: str) -> set[str]:
    config = {"configurable": {"thread_id": thread_id}}
    return {c.config["configurable"]["checkpoint_ns"] async for c in saver.alist(config)}


@pytest.mark.parametrize("saver_kind", ["memory", "postgres"])
async def test_delete_thread_removes_all_namespaces(
    monkeypatch: pytest.MonkeyPatch, saver_kind: str
) -> None:
    if saver_kind == "memory":
        await _delete_thread_check(monkeypatch, InMemorySaver())
        return
    # Only ever a throwaway local database, e.g.
    # TEST_POSTGRES_URI=postgresql://postgres:postgres@localhost:55432/postgres
    uri = os.environ.get("TEST_POSTGRES_URI")
    if not uri:
        pytest.skip("set TEST_POSTGRES_URI to a local throwaway Postgres to run this")
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

    async with AsyncPostgresSaver.from_conn_string(uri) as saver:
        await saver.setup()
        await _delete_thread_check(monkeypatch, saver)


async def _delete_thread_check(monkeypatch: pytest.MonkeyPatch, saver: Any) -> None:
    async with serve(monkeypatch, saver) as c:
        await run(c, [user("resume:alpha|web:rust")], thread_id="doomed")
        await run(c, [user("resume:gamma")], thread_id="kept")
        namespaces = await _checkpoint_namespaces(saver, "doomed")
        assert "" in namespaces and len([ns for ns in namespaces if ns.startswith("tools:")]) >= 2

        response = await c.request("DELETE", "/thread", json={"thread_id": "doomed"})
        assert response.status_code == 200
        assert await _checkpoint_namespaces(saver, "doomed") == set()
        assert await _checkpoint_namespaces(saver, "kept")


async def test_messages_wait_while_a_follow_up_holds_the_thread(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("agents.assistant.follow_ups._following", {"thread-1"})
    body = {
        "threadId": "thread-1",
        "runId": "run-busy",
        "messages": [user("hello")],
        "forwardedProps": {"model": "fake", "user_id": "user-1"},
    }
    assert (await client.post(f"/{DEFAULT_AGENT}/ag-ui", json=body)).status_code == 409
    revert = {"thread_id": "thread-1", "message_id": "user-1"}
    assert (await client.post("/thread/revert", json=revert)).status_code == 409
    deleted = await client.request("DELETE", "/thread", json={"thread_id": "thread-1"})
    assert deleted.status_code == 409


async def test_a_run_can_be_followed_again_from_any_event(client: httpx.AsyncClient) -> None:
    events = await run(client, [user("web:rust", id="u-live")], thread_id="thread-live")
    stream = await client.get(f"/{DEFAULT_AGENT}/ag-ui/thread-live/live", params={"since": 3})
    assert stream.status_code == 200
    again = [json.loads(x[6:]) for x in stream.text.splitlines() if x.startswith("data: ")]
    # A client that had the first three events gets exactly the rest.
    assert again == events[3:]
    # It has ended, so it no longer counts as running.
    status = await client.get("/ag-ui/thread-live/live")
    assert status.json() == {"running": False}
    assert (await client.get(f"/{DEFAULT_AGENT}/ag-ui/nothing-here/live")).status_code == 404


async def test_assistant_subagents_stream_into_their_task_cards(
    monkeypatch: pytest.MonkeyPatch, saver: Any
) -> None:
    """The assistant's `agent` commands, with and without a focus, open sub-agent runs tied
    to their call, which finish when the call returns rather than at the end of the run."""
    from agui_fakes import ScriptedChatModel
    from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage

    from agents.assistant import agent as assistant
    from agents.configurable_model_graph import ConfigurableModelGraph

    def respond(messages: list[BaseMessage]) -> AIMessage:
        first = messages[0].content if isinstance(messages[0].content, str) else ""
        if "You are a sub-agent" in first:
            return AIMessage(content=f"found {messages[-1].content}")
        if isinstance(messages[-1], HumanMessage):
            # The model writes `agent` commands; they're stored and run as `task` calls.
            calls = [
                {"name": "run", "args": {"command": "agent python"}, "id": "call_py"},
                {
                    "name": "run",
                    "args": {"command": "agent --type research <<'EOF'\nnode\nEOF"},
                    "id": "call_node",
                },
            ]
            return AIMessage(content="", tool_calls=calls)
        assert isinstance(messages[-1], ToolMessage)
        return AIMessage(content="both found")

    model = ScriptedChatModel(responder=respond)
    monkeypatch.setattr(assistant, "get_model", lambda name: model)
    monkeypatch.setattr(
        assistant,
        "assistant_subagent",
        ConfigurableModelGraph(lambda m: assistant._build(m, subagent=True)),
    )
    graph = ConfigurableModelGraph(lambda m: assistant._build(m, subagent=False))
    graph.checkpointer = saver
    async with serve(monkeypatch, saver) as client:
        with patch.dict("agents.agents.agents", {"assistant": Agent(description="a", graph=graph)}):
            events = await run(client, [user("go")], agent_id="assistant")

    assert_wire_hygiene(events)
    runs = subagent_runs(events)
    assert set(runs) == {"call_py", "call_node"}
    assert runs["call_py"]["name"] == "general" and runs["call_py"]["description"] == "python"
    assert runs["call_node"]["name"] == "research"
    for call_id, answer in (("call_py", "found python"), ("call_node", "found node")):
        run_id = runs[call_id]["subagentRunId"]
        assert_closed_before_result(events, run_id, call_id)
        tagged = [e for e in events if e.get("subagentRunId") == run_id]
        assert "".join(e["delta"] for e in tagged if e["type"] == "TEXT_MESSAGE_CONTENT") == answer
    # Both are finished before the assistant starts its reply.
    reply = next(
        i
        for i, e in enumerate(events)
        if e["type"] == "TEXT_MESSAGE_START" and "subagentRunId" not in e
    )
    assert max(i for i, e in enumerate(events) if e["type"] == "SUBAGENT_FINISHED") < reply
    # The UI's tests replay this stream; a change here that the UI doesn't expect fails there.
    recorded = _normalize_ids([{k: v for k, v in e.items() if k != "timestamp"} for e in events])
    if os.environ.get("UPDATE_FIXTURES"):
        STREAM_FIXTURE.write_text(json.dumps(recorded, indent=2) + "\n")
    assert stream_shape(recorded) == stream_shape(json.loads(STREAM_FIXTURE.read_text()))
