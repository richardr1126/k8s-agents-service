"""Agent runs that outlive the request that started them.

A run streams its AG-UI events into a buffer as a task of its own, so a dropped
connection (a proxy reset, a refresh, a closed tab) no longer cancels it. Any
request can follow the run from an event offset: the one that started it from 0,
a client reconnecting after a drop from the number of events it already has, a
page opening the conversation from 0 again. Stopping is an explicit call.

Runs live in this process's memory; the deployment runs one replica.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from ag_ui.core import RunErrorEvent
from ag_ui.encoder import EventEncoder

logger = logging.getLogger(__name__)

# How long a finished run stays joinable, so a client that dropped just before the end gets the rest.
KEEP_SECONDS = 120.0


@dataclass
class LiveRun:
    thread_id: str
    agent_id: str
    # The last message the run started from; a page joining from 0 shows the history up to it.
    after: str | None
    events: list[str] = field(default_factory=list)
    done: bool = False
    task: asyncio.Task[None] | None = None
    _changed: asyncio.Condition = field(default_factory=asyncio.Condition)

    async def _add(self, event: str) -> None:
        async with self._changed:
            self.events.append(event)
            self._changed.notify_all()

    async def _finish(self) -> None:
        async with self._changed:
            self.done = True
            self._changed.notify_all()

    async def follow(self, start: int = 0) -> AsyncIterator[str]:
        """The run's events from `start` on, until it ends; leaving early leaves the run going."""
        index = max(0, start)
        while True:
            async with self._changed:
                await self._changed.wait_for(lambda: len(self.events) > index or self.done)
                batch = self.events[index:]
                finished = self.done
            index += len(batch)
            for event in batch:
                yield event
            if finished and index >= len(self.events):
                return


_runs: dict[str, LiveRun] = {}


def get(thread_id: str) -> LiveRun | None:
    return _runs.get(thread_id)


def running(thread_id: str) -> LiveRun | None:
    run = _runs.get(thread_id)
    return run if run is not None and not run.done else None


def start(thread_id: str, agent_id: str, after: str | None, events: AsyncIterator[str]) -> LiveRun:
    """Starts pumping `events` into a new live run on the thread."""
    run = LiveRun(thread_id=thread_id, agent_id=agent_id, after=after)
    _runs[thread_id] = run

    async def pump() -> None:
        try:
            async for event in events:
                await run._add(event)
        except asyncio.CancelledError:
            logger.info("Run on thread %s stopped", thread_id)
        except Exception as error:
            logger.exception("Run on thread %s failed", thread_id)
            await run._add(
                EventEncoder().encode(RunErrorEvent(message=str(error) or type(error).__name__))
            )
        finally:
            await run._finish()
            asyncio.get_running_loop().call_later(KEEP_SECONDS, _forget, run)

    run.task = asyncio.create_task(pump(), name=f"run:{thread_id}")
    return run


def _forget(run: LiveRun) -> None:
    if _runs.get(run.thread_id) is run:
        del _runs[run.thread_id]


async def stop(thread_id: str) -> bool:
    """Cancels the thread's run; False when none is running."""
    run = running(thread_id)
    if run is None or run.task is None:
        return False
    run.task.cancel()
    try:
        await run.task
    except asyncio.CancelledError:
        pass
    return True


async def stop_all() -> None:
    """At shutdown: the runs end with the process."""
    for run in list(_runs.values()):
        if run.task is not None and not run.done:
            run.task.cancel()
    tasks = [r.task for r in _runs.values() if r.task is not None]
    await asyncio.gather(*tasks, return_exceptions=True)
