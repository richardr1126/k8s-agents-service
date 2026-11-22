"""Runs workflows as background jobs in this process and records their progress."""

from __future__ import annotations

import asyncio
import logging
from typing import Any
from uuid import uuid4

from langchain_core.runnables import RunnableConfig

from core import settings
from jobs.store import Job, JobStore, MemoryJobStore, PostgresJobStore
from skills import Workflow, call_workflow

logger = logging.getLogger(__name__)

_store: JobStore = MemoryJobStore()
_tasks: set[asyncio.Task[None]] = set()


class JobError(RuntimeError):
    pass


async def setup_jobs(saver: Any) -> None:
    """Keeps jobs in Postgres when the checkpointer is Postgres, else in memory."""
    global _store
    pool = getattr(saver, "conn", None)
    _store = (
        PostgresJobStore(pool)
        if pool is not None and hasattr(pool, "connection")
        else MemoryJobStore()
    )
    await _store.setup()


def store() -> JobStore:
    return _store


async def start(workflow: Workflow, args: dict[str, Any], config: RunnableConfig) -> Job:
    configurable = config.get("configurable") or {}
    user_id = str(configurable.get("user_id") or "")
    if not user_id:
        raise JobError("Background jobs need a signed-in user.")
    limit = settings.ASSISTANT_MAX_JOBS_PER_USER
    if await _store.running_for(user_id) >= limit:
        raise JobError(f"You already have {limit} background jobs running; wait for one to finish.")
    job = Job(
        id=f"job-{uuid4().hex[:12]}",
        user_id=user_id,
        thread_id=configurable.get("thread_id"),
        workflow=workflow.id,
        args=args,
    )
    await _store.create(job)

    async def progress(message: str, **data: Any) -> None:
        fields: dict[str, Any] = {"progress": message[:300]}
        if data:
            fields["data"] = data
        await _store.update(job.id, **fields)

    # A fresh config: the job outlives the chat run, its callbacks and its stream.
    job_config: RunnableConfig = {
        "configurable": {
            "model": configurable.get("model"),
            "user_id": user_id,
            "job_id": job.id,
            "job_progress": progress,
        },
        "metadata": {"job_id": job.id, "workflow": workflow.id},
        "run_name": f"job:{workflow.id}",
    }

    async def run() -> None:
        try:
            result = await call_workflow(workflow.resolve(), args, job_config)
            text, data = (
                (result.get("text", ""), result.get("data", {}))
                if isinstance(result, dict)
                else (str(result), None)
            )
            fields: dict[str, Any] = {"status": "done", "progress": "Done", "result": text}
            if data is not None:
                fields["data"] = data
            await _store.update(job.id, **fields)
        except Exception as e:
            logger.exception("Job %s (%s) failed", job.id, workflow.id)
            await _store.update(job.id, status="error", error=str(e)[:1000] or type(e).__name__)

    task = asyncio.create_task(run(), name=job.id)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return job


def job_id_of(ctx: RunnableConfig | None) -> str | None:
    """The running job's id; None outside a job."""
    return ((ctx or {}).get("configurable") or {}).get("job_id")


async def save_job_file(
    ctx: RunnableConfig | None, name: str, content_type: str, data: bytes
) -> str:
    """For workflows: keeps a file the job produced; returns the job id it belongs to."""
    job_id = job_id_of(ctx)
    if not job_id:
        raise JobError("Files can only be saved from a background job.")
    await _store.save_file(job_id, name, content_type, data)
    return job_id


async def report_progress(ctx: RunnableConfig | None, message: str, **data: Any) -> None:
    """For workflows: updates the job's progress line (and data); a no-op outside a job."""
    callback = ((ctx or {}).get("configurable") or {}).get("job_progress")
    if callback:
        await callback(message, **data)
