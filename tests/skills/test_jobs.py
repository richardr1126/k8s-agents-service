import asyncio

import pytest

import jobs
from jobs import runner
from jobs.store import MemoryJobStore
from skills.registry import Workflow, _arg_model

pytestmark = pytest.mark.asyncio


async def ok(n: int, ctx=None) -> dict:
    await jobs.report_progress(ctx, "halfway")
    return {"text": f"got {n}", "data": {"n": n}}


async def boom(ctx=None) -> str:
    raise RuntimeError("nope")


def workflow(fn_name: str) -> Workflow:
    args = {"n": {"type": "integer", "required": True}} if fn_name == "ok" else {}
    return Workflow(
        id=f"t.{fn_name}",
        description="x",
        impl=f"{__name__}:{fn_name}",
        background=True,
        args=args,
        model=_arg_model(f"t.{fn_name}", args, __file__),  # type: ignore[arg-type]
    )


async def settle() -> None:
    await asyncio.gather(*runner._tasks)


@pytest.fixture(autouse=True)
def memory_store(monkeypatch: pytest.MonkeyPatch) -> MemoryJobStore:
    store = MemoryJobStore()
    monkeypatch.setattr(runner, "_store", store)
    return store


async def test_job_runs_and_records_result() -> None:
    job = await jobs.start(workflow("ok"), {"n": 3}, {"configurable": {"user_id": "u1"}})
    await settle()
    done = await jobs.store().get(job.id)
    assert done and done.status == "done" and done.result == "got 3" and done.data == {"n": 3}


async def test_failed_job_records_error() -> None:
    job = await jobs.start(workflow("boom"), {}, {"configurable": {"user_id": "u1"}})
    await settle()
    failed = await jobs.store().get(job.id)
    assert failed and failed.status == "error" and "nope" in (failed.error or "")


async def test_jobs_need_a_user_and_are_capped(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(jobs.JobError):
        await jobs.start(workflow("ok"), {"n": 1}, {"configurable": {}})
    monkeypatch.setattr(runner.settings, "ASSISTANT_MAX_JOBS_PER_USER", 1)
    gate = asyncio.Event()

    async def slow(ctx=None) -> str:
        await gate.wait()
        return "ok"

    globals()["slow"] = slow
    await jobs.start(workflow("slow"), {}, {"configurable": {"user_id": "u2"}})
    with pytest.raises(jobs.JobError):
        await jobs.start(workflow("slow"), {}, {"configurable": {"user_id": "u2"}})
    gate.set()
    await settle()
