"""Starting and checking background jobs from the assistant's tools."""

from __future__ import annotations

from typing import Any

from langchain_core.runnables import RunnableConfig

import jobs
from skills import Workflow

JOB_MARKER = "Started background job"


async def start_job(workflow: Workflow, args: dict[str, Any], config: RunnableConfig) -> str:
    try:
        job = await jobs.start(workflow, args, config)
    except jobs.JobError as e:
        return str(e)
    # The UI finds the job id in this line and shows a live job card.
    return (
        f"{JOB_MARKER} `{job.id}` for `{workflow.id}`. It runs on its own; a card just above "
        "your reply shows its progress and then its result. In one or two sentences, tell the user "
        "it has started and that the result will appear in the card above. Don't show the job id, don't wait "
        "for it, and don't promise to notify them. Use `check_job` if they ask about it later."
    )


async def describe_job(job_id: str, config: RunnableConfig) -> str:
    user_id = str(((config or {}).get("configurable") or {}).get("user_id") or "")
    job = await jobs.store().get(job_id.strip())
    if job is None or job.user_id != user_id:
        return f"No job {job_id!r}."
    if job.status == "running":
        return f"`{job.id}` ({job.workflow}) is still running: {job.progress}."
    if job.status == "error":
        return f"`{job.id}` ({job.workflow}) failed: {job.error}"
    return f"`{job.id}` ({job.workflow}) finished.\n\n{job.result or '(no text result)'}"
