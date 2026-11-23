import asyncio
from types import SimpleNamespace
from typing import Any

import pytest

import jobs
from agents.assistant import follow_ups
from jobs import runner
from jobs.store import MemoryJobStore

pytestmark = pytest.mark.asyncio

CONFIG = {"configurable": {"user_id": "u1", "thread_id": "t1", "model": "fake", "focus": "papers"}}


class FakeGraph:
    """Answers a thread's ended jobs the way the assistant's model node does."""

    def __init__(self, *, messages: list[Any] | None = None, takes_events: bool = True) -> None:
        self.messages = ["hi", "hello"] if messages is None else messages
        self.takes_events = takes_events
        self.runs: list[dict[str, Any]] = []
        self.gate: asyncio.Event | None = None

    async def aget_state(self, config: Any) -> Any:
        return SimpleNamespace(values={"messages": self.messages}, next=())

    async def ainvoke(self, input: Any, config: Any) -> None:
        self.runs.append(config)
        if self.gate:
            await self.gate.wait()
        if self.takes_events:
            ended = await jobs.store().unnotified("u1", "t1")
            await jobs.store().mark_notified([job.id for job in ended])


@pytest.fixture(autouse=True)
def isolated(monkeypatch: pytest.MonkeyPatch) -> MemoryJobStore:
    store = MemoryJobStore()
    monkeypatch.setattr(runner, "_store", store)
    monkeypatch.setattr(runner, "_on_end", [])
    monkeypatch.setattr(follow_ups, "_following", set())
    monkeypatch.setattr(follow_ups, "_started", {})
    monkeypatch.setattr(follow_ups.settings, "AVAILABLE_MODELS", {"fake"})
    follow_ups.install()
    return store


@pytest.fixture
def graph(monkeypatch: pytest.MonkeyPatch) -> FakeGraph:
    fake = FakeGraph()
    monkeypatch.setattr("agents.get_agent", lambda agent_id: fake)
    return fake


async def settle() -> None:
    for _ in range(50):
        pending = list(runner._tasks) + list(follow_ups._tasks)
        if not pending:
            return
        await asyncio.gather(*pending, return_exceptions=True)


async def done(config: Any) -> str:
    return "the result"


async def test_an_ended_job_is_answered_on_its_thread(graph: FakeGraph) -> None:
    job = await jobs.start("papers.podcast", {}, CONFIG, done)
    await settle()
    assert len(graph.runs) == 1
    configurable = graph.runs[0]["configurable"]
    assert configurable == {"thread_id": "t1", "user_id": "u1", "model": "fake", "focus": "papers"}
    assert graph.runs[0]["metadata"] == {"follow_up": True}
    assert (await jobs.store().get(job.id)).notified  # type: ignore[union-attr]
    assert not follow_ups.busy("t1")


async def test_a_follow_up_waits_for_the_reply_in_progress(graph: FakeGraph) -> None:
    async with follow_ups.thread_run("t1"):
        await jobs.start("papers.podcast", {}, CONFIG, done)
        for _ in range(20):
            await asyncio.sleep(0)
        assert follow_ups.busy("t1") and not graph.runs
    await settle()
    assert len(graph.runs) == 1


async def test_busy_while_answering(graph: FakeGraph) -> None:
    graph.gate = asyncio.Event()
    await jobs.start("papers.podcast", {}, CONFIG, done)
    for _ in range(50):
        await asyncio.sleep(0)
        if graph.runs:
            break
    assert follow_ups.busy("t1")
    graph.gate.set()
    await settle()
    assert not follow_ups.busy("t1")


async def test_follow_ups_are_capped_per_user(
    graph: FakeGraph, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(follow_ups.settings, "ASSISTANT_FOLLOW_UPS_PER_HOUR", 1)
    await jobs.start("a", {}, CONFIG, done)
    await settle()
    second = await jobs.start("b", {}, CONFIG, done)
    await settle()
    assert len(graph.runs) == 1
    assert not (await jobs.store().get(second.id)).notified  # type: ignore[union-attr]


async def test_a_deleted_thread_gets_no_run(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeGraph(messages=[])
    monkeypatch.setattr("agents.get_agent", lambda agent_id: fake)
    await jobs.start("a", {}, CONFIG, done)
    await settle()
    assert not fake.runs and not follow_ups.busy("t1")


async def test_a_run_that_leaves_the_jobs_pending_is_not_repeated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = FakeGraph(takes_events=False)
    monkeypatch.setattr("agents.get_agent", lambda agent_id: fake)
    await jobs.start("a", {}, CONFIG, done)
    await settle()
    assert len(fake.runs) == 1


async def test_an_unknown_model_falls_back_to_the_default(
    graph: FakeGraph, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(follow_ups.settings, "DEFAULT_MODEL", "fake")
    config = {"configurable": {**CONFIG["configurable"], "model": "gone"}}
    await jobs.start("a", {}, config, done)
    await settle()
    assert graph.runs[0]["configurable"]["model"] == "fake"


async def test_jobs_without_a_thread_are_left_alone(graph: FakeGraph) -> None:
    await jobs.start("a", {}, {"configurable": {"user_id": "u1"}}, done)
    await settle()
    assert not graph.runs
