"""Runs tool calls as background jobs in this process and records their progress and outcome.

Jobs survive restarts: each process heartbeats the jobs it runs, and sweeps for
running jobs whose heartbeat stopped (their process died or was replaced by a
deploy). A swept job whose workflow checkpointed a graph (`jobs.graphs`) is resumed
from its last finished step; any other is marked stopped and its thread told.
"""

from __future__ import annotations

import asyncio
import contextvars
import json
import logging
from collections.abc import Callable, Coroutine
from typing import Any
from uuid import uuid4

from langchain_core.messages import BaseMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.runnables.config import var_child_runnable_config

from core import settings
from jobs.store import Job, JobStore, MemoryJobStore, PostgresJobStore

logger = logging.getLogger(__name__)

_store: JobStore = MemoryJobStore()
_tasks: set[asyncio.Task[Any]] = set()
# Jobs this process runs, heartbeated so other processes leave them alone.
_owned: set[str] = set()
_sweeper: asyncio.Task[Any] | None = None
_stopping = False

HEARTBEAT_SECONDS = 30
# Comfortably longer than a heartbeat and a pod's shutdown grace period.
STALE_SECONDS = 120
STOPPED = "Stopped by a server restart."

# Called with each job's id as soon as its outcome is recorded, and the configurable
# of the run that started it (model, focus, user and thread). Synchronous, so nothing
# runs between the outcome being stored and the callbacks.
Ended = Callable[[str, dict[str, Any]], None]
_on_end: list[Ended] = []


def on_job_end(callback: Ended) -> None:
    """Registers a callback for ended jobs. A failing callback never affects the job."""
    if callback not in _on_end:
        _on_end.append(callback)


class JobError(RuntimeError):
    pass


async def setup_jobs(saver: Any) -> None:
    """Keeps jobs in Postgres when the checkpointer is Postgres, else in memory, and job
    graphs' checkpoints in the same checkpointer. With Postgres, also starts the
    heartbeat-and-sweep loop that resumes jobs other processes left behind."""
    global _store, _sweeper, _stopping
    from jobs.graphs import use_saver

    pool = getattr(saver, "conn", None)
    shared = pool is not None and hasattr(pool, "connection")
    _store = PostgresJobStore(pool) if shared else MemoryJobStore()
    await _store.setup()
    use_saver(saver)
    _stopping = False
    if shared and _sweeper is None:
        _sweeper = asyncio.create_task(_heartbeat_and_sweep(), name="jobs:sweeper")


async def stop_jobs() -> None:
    """At shutdown: stops this process's jobs without recording an outcome, so they stay
    `running`, go stale, and are resumed by the next process to sweep."""
    global _sweeper, _stopping
    _stopping = True
    if _sweeper is not None:
        _sweeper.cancel()
        _sweeper = None
    pending = [t for t in _tasks if not t.done()]
    for task in pending:
        task.cancel()
    await asyncio.gather(*pending, return_exceptions=True)
    _owned.clear()


async def _heartbeat_and_sweep() -> None:
    while True:
        try:
            await _store.touch(sorted(_owned))
            await sweep()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Job heartbeat or sweep failed")
        await asyncio.sleep(HEARTBEAT_SECONDS)


async def sweep() -> list[str]:
    """Claims jobs left behind by a dead process; resumes those that can be. Returns their ids."""
    resumed = []
    for job in await _store.claim_stale(STALE_SECONDS):
        if job.id in _owned:
            continue
        try:
            ok = await _resume(job)
        except Exception:
            logger.exception("Resuming job %s failed", job.id)
            ok = False
        if ok:
            resumed.append(job.id)
            continue
        await _store.update(job.id, status="error", error=STOPPED)
        _tell_ended(job.id, {"user_id": job.user_id, "thread_id": job.thread_id})
    return resumed


async def _resume(job: Job) -> bool:
    """Restarts a job whose workflow left a graph checkpoint; False if it can't be resumed."""
    from jobs.graphs import saved_run
    from skills import call_workflow, get_registry

    wf = get_registry().workflows.get(job.workflow)
    carried = await saved_run(job.id) if wf else None
    if wf is None or carried is None:
        return False
    fn = wf.resolve()
    config: RunnableConfig = {
        "configurable": {**carried, "user_id": job.user_id, "thread_id": job.thread_id}
    }
    logger.info("Resuming job %s (%s)", job.id, job.workflow)
    await _store.update(job.id, progress="Resuming after a server restart…")
    _launch(job.id, job.workflow, config, lambda c: call_workflow(fn, job.args, c))
    return True


def store() -> JobStore:
    return _store


Run = Callable[[RunnableConfig], Coroutine[Any, Any, Any]]


def _new_id() -> str:
    return f"job-{uuid4().hex[:12]}"


def _user_id(config: RunnableConfig) -> str:
    return str((config.get("configurable") or {}).get("user_id") or "")


def _job_config(config: RunnableConfig, job_id: str, progress: Any) -> RunnableConfig:
    """A fresh config: the job outlives the chat run, its callbacks and its stream."""
    configurable = config.get("configurable") or {}
    return {
        "configurable": {
            "model": configurable.get("model"),
            "user_id": configurable.get("user_id"),
            "thread_id": configurable.get("thread_id"),
            "focus": configurable.get("focus"),
            "checkpoint_ns": f"job:{job_id}",
            "job_id": job_id,
            "job_progress": progress,
        },
        "metadata": {"job_id": job_id},
    }


def detached(coro: Coroutine[Any, Any, Any], name: str) -> asyncio.Task[Any]:
    """A task outside the chat run's context. LangChain merges the context's config,
    callbacks included, into every config it's given, so a job started in it would
    stream into the chat."""
    context = contextvars.copy_context()
    context.run(var_child_runnable_config.set, None)
    return asyncio.create_task(coro, name=name, context=context)


def as_text(result: Any) -> str:
    if isinstance(result, BaseMessage):
        content = result.content
        return content if isinstance(content, str) else json.dumps(content, default=str)
    if isinstance(result, str):
        return result
    return json.dumps(result, ensure_ascii=False, default=str)


def _outcome(result: Any) -> dict[str, Any]:
    """A workflow may return {"text": ..., "data": {...}}; anything else is the text."""
    if isinstance(result, dict) and set(result) <= {"text", "data"} and result:
        fields: dict[str, Any] = {"result": str(result.get("text") or "")}
        if result.get("data") is not None:
            fields["data"] = result["data"]
        return fields
    return {"result": as_text(result)}


async def _admit(config: RunnableConfig) -> str:
    user_id = _user_id(config)
    if not user_id:
        raise JobError("Background jobs need a signed-in user.")
    limit = settings.ASSISTANT_MAX_JOBS_PER_USER
    if await _store.running_for(user_id) >= limit:
        raise JobError(f"You already have {limit} background jobs running; wait for one to finish.")
    return user_id


def _job(
    job_id: str, user_id: str, label: str, args: dict[str, Any], config: RunnableConfig
) -> Job:
    return Job(
        id=job_id,
        user_id=user_id,
        thread_id=(config.get("configurable") or {}).get("thread_id"),
        workflow=label,
        args=args,
    )


def _finish(
    job_id: str, label: str, task: asyncio.Future[Any], configurable: dict[str, Any]
) -> None:
    """Records the job's outcome when its task ends, then tells the end callbacks."""

    async def record() -> None:
        try:
            result = await task
        except asyncio.CancelledError:
            if _stopping:
                return  # left running for the next process to resume
            await _store.update(job_id, status="error", error="Cancelled.")
        except Exception as e:
            logger.exception("Job %s (%s) failed", job_id, label)
            await _store.update(job_id, status="error", error=str(e)[:1000] or type(e).__name__)
        else:
            await _store.update(job_id, status="done", progress="Done", **_outcome(result))
        finally:
            _owned.discard(job_id)
        _tell_ended(job_id, configurable)

    _keep(asyncio.create_task(record(), name=f"{job_id}:record"))


def _tell_ended(job_id: str, configurable: dict[str, Any]) -> None:
    for callback in list(_on_end):
        try:
            callback(job_id, configurable)
        except Exception:
            logger.exception("Job %s end callback failed", job_id)


def _keep(task: asyncio.Task[Any]) -> None:
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def start(label: str, args: dict[str, Any], config: RunnableConfig, run: Run) -> Job:
    """Starts `run` as a background job and returns at once."""
    user_id = await _admit(config)
    job = _job(_new_id(), user_id, label, args, config)
    await _store.create(job)
    _launch(job.id, label, config, run)
    return job


def _launch(job_id: str, label: str, config: RunnableConfig, run: Run) -> None:
    """Runs a recorded job in this process."""

    async def progress(message: str, **data: Any) -> None:
        fields: dict[str, Any] = {"progress": message[:300]}
        if data:
            fields["data"] = data
        await _store.update(job_id, **fields)

    _owned.add(job_id)
    task = detached(run(_job_config(config, job_id, progress)), job_id)
    _keep(task)
    _finish(job_id, label, task, dict(config.get("configurable") or {}))


async def run_or_promote(
    label: str, args: dict[str, Any], config: RunnableConfig, run: Run, *, after: float
) -> tuple[Any, Job | None]:
    """Runs `run` inline; if it's still going after `after` seconds, it carries on as a job.

    Returns (result, None) when it finished in time, else (None, job). It stays
    inline when it can't become a job (no signed-in user, or too many jobs).
    """
    job_id = _new_id()
    latest: dict[str, Any] = {"progress": "Starting", "job": False}

    async def progress(message: str, **data: Any) -> None:
        latest["progress"] = message[:300]
        if data:
            latest["data"] = data
        if latest["job"]:
            await _store.update(job_id, **{k: v for k, v in latest.items() if k != "job"})

    task = detached(run(_job_config(config, job_id, progress)), job_id)
    try:
        done, _ = await asyncio.wait({task}, timeout=after)
        if task in done:
            return task.result(), None
        try:
            user_id = await _admit(config)
        except JobError:
            return await task, None
    except asyncio.CancelledError:
        task.cancel()
        raise
    job = _job(job_id, user_id, label, args, config)
    job.progress = latest["progress"]
    job.data = latest.get("data") or {}
    await _store.create(job)
    latest["job"] = True
    _owned.add(job_id)
    _keep(task)
    _finish(job_id, label, task, dict(config.get("configurable") or {}))
    return None, job


def job_id_of(ctx: RunnableConfig | None) -> str | None:
    """The running job's id; None outside a job."""
    return ((ctx or {}).get("configurable") or {}).get("job_id")


async def save_job_file(
    ctx: RunnableConfig | None, name: str, content_type: str, data: bytes
) -> str:
    """For workflows: keeps a file the job produced; returns the job id it belongs to."""
    job_id = job_id_of(ctx)
    if not job_id or await _store.get(job_id) is None:
        raise JobError("Files can only be saved from a background job.")
    await _store.save_file(job_id, name, content_type, data)
    return job_id


async def report_progress(ctx: RunnableConfig | None, message: str, **data: Any) -> None:
    """For workflows: updates the job's progress line (and data); a no-op outside a job."""
    callback = ((ctx or {}).get("configurable") or {}).get("job_progress")
    if callback:
        await callback(message, **data)
