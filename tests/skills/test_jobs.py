import asyncio
from types import SimpleNamespace
from typing import Any

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.prebuilt.tool_node import ToolCallRequest

import jobs
from agents.assistant import background as bg
from jobs import runner
from jobs.store import Job, MemoryJobStore

pytestmark = pytest.mark.asyncio

USER = {"configurable": {"user_id": "u1", "thread_id": "t1"}}


async def ok(config: Any) -> dict:
    await jobs.report_progress(config, "halfway")
    return {"text": "got 3", "data": {"n": 3}}


async def boom(config: Any) -> str:
    raise RuntimeError("nope")


async def settle() -> None:
    while runner._tasks:
        await asyncio.gather(*list(runner._tasks), return_exceptions=True)


@pytest.fixture(autouse=True)
def memory_store(monkeypatch: pytest.MonkeyPatch) -> MemoryJobStore:
    store = MemoryJobStore()
    monkeypatch.setattr(runner, "_store", store)
    return store


async def test_job_runs_and_records_result() -> None:
    job = await jobs.start("t.ok", {"n": 3}, USER, ok)
    await settle()
    done = await jobs.store().get(job.id)
    assert done and done.status == "done" and done.result == "got 3" and done.data == {"n": 3}
    assert done.thread_id == "t1" and not done.notified


async def test_failed_job_records_error() -> None:
    job = await jobs.start("t.boom", {}, USER, boom)
    await settle()
    failed = await jobs.store().get(job.id)
    assert failed and failed.status == "error" and "nope" in (failed.error or "")


async def test_jobs_need_a_user_and_are_capped(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(jobs.JobError):
        await jobs.start("t.ok", {}, {"configurable": {}}, ok)
    monkeypatch.setattr(runner.settings, "ASSISTANT_MAX_JOBS_PER_USER", 1)
    gate = asyncio.Event()

    async def slow(config: Any) -> str:
        await gate.wait()
        return "ok"

    await jobs.start("t.slow", {}, USER, slow)
    with pytest.raises(jobs.JobError):
        await jobs.start("t.slow", {}, USER, slow)
    gate.set()
    await settle()


async def test_fast_inline_run_returns_its_result() -> None:
    result, job = await jobs.run_or_promote("t.ok", {}, USER, ok, after=5)
    assert job is None and result["text"] == "got 3"


async def test_slow_inline_run_becomes_a_job() -> None:
    gate = asyncio.Event()

    async def slow(config: Any) -> str:
        await jobs.report_progress(config, "still going")
        await gate.wait()
        await jobs.report_progress(config, "almost")
        return "late"

    result, job = await jobs.run_or_promote("t.slow", {}, USER, slow, after=0.05)
    assert result is None and job is not None
    running = await jobs.store().get(job.id)
    assert running and running.status == "running" and running.progress == "still going"
    gate.set()
    await settle()
    done = await jobs.store().get(job.id)
    assert done and done.status == "done" and done.result == "late"


# --- The tool-call wrapper ---


def request(name: str, args: dict[str, Any], *, subagent: bool = False) -> Any:
    config = {"configurable": {**USER["configurable"], "assistant_subagent": subagent}}
    return ToolCallRequest(
        tool_call={"name": name, "args": args, "id": "call-1"},
        tool=None,
        state={},
        runtime=SimpleNamespace(config=config),  # type: ignore[arg-type]
    )


def planners(policy: str, run: Any = ok, promote: bool = False) -> dict[str, bg.Planner]:
    return {"t": lambda req: bg.Plan(policy=policy, label="t.x", args={}, run=run, promote=promote)}  # type: ignore[arg-type]


async def inline(req: ToolCallRequest) -> ToolMessage:
    """ToolNode's execute: runs the request's tool, here the wrapper's stand-in if it set one."""
    if req.tool is not None:
        return await req.tool.ainvoke({"type": "tool_call", **req.tool_call})
    return ToolMessage(content="ran inline", tool_call_id="call-1")


async def test_optional_runs_inline_unless_asked() -> None:
    wrap = bg.background_jobs(planners("optional"))
    assert (await wrap(request("t", {}), inline)).content == "ran inline"
    started = await wrap(request("t", {"background": True}), inline)
    assert bg.JOB_MARKER in started.content
    await settle()


async def test_always_runs_as_a_job_and_never_refuses_background() -> None:
    started = await bg.background_jobs(planners("always"))(request("t", {}), inline)
    assert bg.JOB_MARKER in started.content
    refused = await bg.background_jobs(planners("never"))(
        request("t", {"background": True}), inline
    )
    assert refused.status == "error" and "can't run in the background" in refused.content
    await settle()


async def test_subagents_cannot_start_jobs() -> None:
    refused = await bg.background_jobs(planners("always"))(request("t", {}, subagent=True), inline)
    assert refused.status == "error" and "only the main assistant" in refused.content


async def test_promoted_inline_run_reports_the_job() -> None:
    gate = asyncio.Event()

    async def slow(config: Any) -> str:
        await gate.wait()
        return "done"

    runner.settings.ASSISTANT_INLINE_SECONDS, before = (
        0.05,
        runner.settings.ASSISTANT_INLINE_SECONDS,
    )
    try:
        reply = await bg.background_jobs(planners("optional", slow, promote=True))(
            request("t", {}), inline
        )
    finally:
        runner.settings.ASSISTANT_INLINE_SECONDS = before
    assert "taking a while" in reply.content and bg.JOB_MARKER in reply.content
    gate.set()
    await settle()


async def test_other_tools_pass_through() -> None:
    assert (await bg.background_jobs({})(request("web_search", {}), inline)).content == "ran inline"


# --- Job events ---


async def test_ended_jobs_become_events_once() -> None:
    job = await jobs.start("t.ok", {}, USER, ok)
    await settle()
    ended = await bg.pending_events([HumanMessage(content="hi")], USER)
    assert [j.id for j in ended] == [job.id]
    event = bg.event_message(ended[0])
    assert bg.is_event(event) and 'status="done"' in event.content and "got 3" in event.content
    assert "not a message from the user" in event.content
    await jobs.store().mark_notified([job.id])
    assert await bg.pending_events([HumanMessage(content="hi")], USER) == []


async def test_events_wait_while_a_turn_is_using_tools() -> None:
    await jobs.start("t.ok", {}, USER, ok)
    await settle()
    mid_turn = [HumanMessage(content="hi"), ToolMessage(content="x", tool_call_id="c")]
    assert await bg.pending_events(mid_turn, USER) == []


async def test_failed_job_event_and_follow_up_detection() -> None:
    job = Job(
        id="job-0123456789ab",
        user_id="u1",
        thread_id="t1",
        workflow="t.x",
        args={},
        status="error",
        error="boom",
    )
    assert (
        'status="error"' in bg.event_message(job).content
        and "boom" in bg.event_message(job).content
    )
    assert bg.awaiting_input([HumanMessage(content="hi"), AIMessage(content="done")])
    assert not bg.awaiting_input([HumanMessage(content="hi")])
