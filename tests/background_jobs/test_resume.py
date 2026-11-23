import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any, TypedDict

import pytest
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph

from jobs import graphs, runner
from jobs.store import Job, MemoryJobStore

pytestmark = pytest.mark.asyncio


class S(TypedDict, total=False):
    n: int
    steps: list[str]


calls: list[str] = []
fail_b = {"left": 0}


async def a(state: S) -> S:
    calls.append("a")
    return {"n": state["n"] + 1, "steps": ["a"]}


async def b(state: S) -> S:
    calls.append("b")
    if fail_b["left"]:
        fail_b["left"] -= 1
        raise RuntimeError("server stopped")
    return {"n": state["n"] * 10, "steps": [*state["steps"], "b"]}


def graph() -> StateGraph:
    g = StateGraph(S)
    g.add_node("a", a)
    g.add_node("b", b)
    g.add_edge(START, "a")
    g.add_edge("a", "b")
    g.add_edge("b", END)
    return g


GRAPH = graph()


@pytest.fixture(autouse=True)
def fresh(monkeypatch: pytest.MonkeyPatch) -> MemoryJobStore:
    graphs.use_saver(InMemorySaver())
    calls.clear()
    fail_b["left"] = 0
    store = MemoryJobStore()
    monkeypatch.setattr(runner, "_store", store)
    runner._owned.clear()
    return store


def ctx(job_id: str, **extra: Any) -> RunnableConfig:
    return {"configurable": {"job_id": job_id, "model": "m1", "focus": "papers", **extra}}


async def test_a_graph_resumes_from_its_last_finished_node() -> None:
    fail_b["left"] = 1
    with pytest.raises(RuntimeError):
        await graphs.run_graph(GRAPH, {"n": 1}, ctx("job-1"))
    assert calls == ["a", "b"]
    assert await graphs.saved_run("job-1") == {"model": "m1", "focus": "papers"}

    # The same job run again carries on at b, with a's output from the checkpoint.
    state = await graphs.run_graph(GRAPH, {"n": 1}, ctx("job-1"))
    assert calls == ["a", "b", "b"]
    assert state["n"] == 20 and state["steps"] == ["a", "b"]
    # A finished job's checkpoints are removed.
    assert await graphs.saved_run("job-1") is None


async def test_separate_jobs_start_fresh() -> None:
    assert (await graphs.run_graph(GRAPH, {"n": 1}, ctx("job-x")))["n"] == 20
    assert (await graphs.run_graph(GRAPH, {"n": 2}, ctx("job-y")))["n"] == 30


def stale(job_id: str, workflow: str) -> Job:
    job = Job(id=job_id, user_id="u1", thread_id="t1", workflow=workflow, args={"subject": "x"})
    job.updated_at = datetime.now(UTC) - timedelta(minutes=10)
    return job


async def test_sweep_resumes_checkpointed_jobs_and_stops_the_rest(
    fresh: MemoryJobStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    # job-r stopped mid-graph; job-s never checkpointed; job-f is fresh, so still owned elsewhere.
    fail_b["left"] = 1
    with pytest.raises(RuntimeError):
        await graphs.run_graph(GRAPH, {"n": 1}, ctx("job-r"))
    for job in (stale("job-r", "papers.podcast"), stale("job-s", "papers.podcast")):
        await fresh.create(job)
    fresh_job = Job(id="job-f", user_id="u1", thread_id="t1", workflow="papers.podcast", args={})
    await fresh.create(fresh_job)

    seen: list[dict[str, Any]] = []

    async def workflow(subject: str, ctx: RunnableConfig | None = None) -> dict[str, Any]:
        seen.append(dict((ctx or {}).get("configurable") or {}))
        state = await graphs.run_graph(GRAPH, {"n": 1}, ctx)
        return {"text": f"n={state['n']}"}

    class WF:
        def resolve(self) -> Any:
            return workflow

    class Registry:
        workflows = {"papers.podcast": WF()}

    monkeypatch.setattr("skills.get_registry", lambda: Registry())
    ended: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(runner, "_on_end", [lambda job_id, c: ended.append((job_id, c))])

    assert await runner.sweep() == ["job-r"]
    for _ in range(50):
        await asyncio.sleep(0)
        if fresh.jobs["job-r"].status != "running":
            break
    assert fresh.jobs["job-r"].status == "done" and fresh.jobs["job-r"].result == "n=20"
    assert seen[0]["model"] == "m1" and seen[0]["user_id"] == "u1" and seen[0]["thread_id"] == "t1"
    assert calls == ["a", "b", "b"]  # a wasn't run again
    assert fresh.jobs["job-s"].status == "error"
    assert fresh.jobs["job-s"].error == runner.STOPPED
    assert fresh.jobs["job-f"].status == "running"
    assert {job_id for job_id, _ in ended} == {"job-r", "job-s"}


async def test_jobs_cancelled_at_shutdown_stay_running(fresh: MemoryJobStore) -> None:
    gate = asyncio.Event()

    async def run(config: RunnableConfig) -> str:
        await gate.wait()
        return "never"

    job = await runner.start("papers.podcast", {}, ctx("ignored", user_id="u1"), run)
    assert job.id in runner._owned
    await runner.stop_jobs()
    await asyncio.sleep(0)
    assert fresh.jobs[job.id].status == "running"
    runner._stopping = False
