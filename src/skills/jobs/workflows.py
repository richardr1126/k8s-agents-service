"""Checking on the chat's background jobs."""

from __future__ import annotations

from langchain_core.runnables import RunnableConfig

import jobs
from agents.assistant.background import describe_job


async def check(job: str, ctx: RunnableConfig) -> str:
    return await describe_job(job, ctx)


async def running(ctx: RunnableConfig) -> str:
    configurable = (ctx or {}).get("configurable") or {}
    user_id, thread_id = configurable.get("user_id"), jobs.chat_thread(configurable)
    if not user_id or not thread_id:
        return "No jobs are running."
    found = await jobs.store().running_on(str(user_id), str(thread_id))
    if not found:
        return "No jobs are running."
    return "\n".join(f"- `{job.id}` ({job.workflow}): {job.progress}" for job in found)
