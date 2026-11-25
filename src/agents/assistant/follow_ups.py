"""The assistant answers its ended background jobs on its own.

When a job ends, the backend runs the assistant on the job's thread, the same way
a reply starts: first any sub-agent work is recorded (a finished background
sub-agent, or a sub-agent continued with the jobs it started; see subagent_jobs),
then the run begins with the job's <job-event> notice, and its reply
is saved to the thread whether or not anyone has the chat open. A job that ends
while a reply is in progress is answered once that reply ends.

One run at a time per thread. A follow-up waits for a reply in progress, and
the chat endpoint refuses a new message while a follow-up holds the thread, since
the client's copy of the thread would be missing the follow-up's reply. The
locks live in this process, as the jobs do, so this assumes one backend replica.
"""

from __future__ import annotations

import asyncio
import logging
import time
import weakref
from collections import deque
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, cast

import jobs
from core import settings

logger = logging.getLogger(__name__)

AGENT_ID = "assistant"
_HOUR = 3600.0

# A lock lives while a run holds it or waits for it.
_locks: weakref.WeakValueDictionary[str, asyncio.Lock] = weakref.WeakValueDictionary()
_following: set[str] = set()  # threads a follow-up holds or is waiting for
_started: dict[str, deque[float]] = {}  # user id -> when their follow-ups started
_tasks: set[asyncio.Task[Any]] = set()


def _lock(thread_id: str) -> asyncio.Lock:
    lock = _locks.get(thread_id)
    if lock is None:
        lock = asyncio.Lock()
        _locks[thread_id] = lock
    return lock


def busy(thread_id: str) -> bool:
    """True while a follow-up is answering on the thread, or waiting to."""
    return thread_id in _following


@asynccontextmanager
async def thread_run(thread_id: str) -> AsyncIterator[None]:
    """Holds the thread for one run."""
    async with _lock(thread_id):
        yield


def _within_cap(user_id: str, *, take: bool) -> bool:
    now = time.monotonic()
    started = _started.setdefault(user_id, deque())
    while started and now - started[0] > _HOUR:
        started.popleft()
    if len(started) >= settings.ASSISTANT_FOLLOW_UPS_PER_HOUR:
        return False
    if take:
        started.append(now)
    return True


def schedule(user_id: str | None, thread_id: str | None, configurable: dict[str, Any]) -> None:
    """Answers the thread's ended jobs, if any, once the thread is free."""
    if not user_id or not thread_id or thread_id in _following:
        return
    _following.add(thread_id)
    task = jobs.detached(
        _answer(str(user_id), str(thread_id), configurable), f"follow-up:{thread_id}"
    )
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def _answer(user_id: str, thread_id: str, configurable: dict[str, Any]) -> None:
    caught_up = False
    try:
        async with thread_run(thread_id):
            answered: set[str] = set()
            while True:
                pending = {job.id for job in await jobs.store().unnotified(user_id, thread_id)}
                if not pending:
                    caught_up = True
                    break
                if pending <= answered:
                    break  # the last run didn't take them; they wait for a message
                answered |= pending
                if not _within_cap(user_id, take=True):
                    logger.info("Follow-ups capped for user %s; jobs wait for a message", user_id)
                    break
                if not await _run(user_id, thread_id, configurable):
                    break
    except Exception:
        logger.exception("Follow-up on thread %s failed", thread_id)
    finally:
        _following.discard(thread_id)
    # A job that ended just now found the thread taken and wasn't scheduled.
    if caught_up and await jobs.store().unnotified(user_id, thread_id):
        schedule(user_id, thread_id, configurable)


async def _run(user_id: str, thread_id: str, configurable: dict[str, Any]) -> bool:
    """Runs the assistant once on the thread. False when the thread can't take a run."""
    from agents import get_agent  # agents imports this package
    from agents.configurable_model_graph import ConfigurableModelGraph
    from service.agui import langfuse_callbacks

    model = configurable.get("model")
    if model not in settings.AVAILABLE_MODELS:
        model = settings.DEFAULT_MODEL
    graph: Any = get_agent(AGENT_ID)
    if isinstance(graph, ConfigurableModelGraph):
        graph = graph.graph_for_model(cast(Any, model))
    config: dict[str, Any] = {
        "recursion_limit": settings.AGENT_RECURSION_LIMIT,
        "callbacks": langfuse_callbacks(),
        "configurable": {
            "thread_id": thread_id,
            "user_id": user_id,
            "model": model,
            # A sub-agent's job carries the chat's focus apart from the sub-agent's own.
            "focus": configurable.get("chat_focus", configurable.get("focus")) or None,
        },
        "metadata": {"follow_up": True},
    }
    state = await graph.aget_state(config)
    if not state.values.get("messages"):
        return False  # the conversation was deleted
    if state.next:
        return False  # a run is paused for the user; it hears about the job when it resumes
    from agents.assistant import subagent_jobs

    # Sub-agent work lands as `task` results; the assistant then answers from there.
    if await subagent_jobs.deliver(graph, cast(Any, config), user_id, thread_id):
        await graph.ainvoke(None, config)
    else:
        await graph.ainvoke({"messages": []}, config)
    return True


def _on_job_end(job_id: str, configurable: dict[str, Any]) -> None:
    schedule(configurable.get("user_id"), configurable.get("thread_id"), configurable)


def install() -> None:
    """Answers each ended job on its thread from now on."""
    jobs.on_job_end(_on_job_end)
