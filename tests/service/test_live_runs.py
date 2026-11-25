import asyncio
from collections.abc import AsyncIterator

import pytest

from service import live_runs

pytestmark = pytest.mark.asyncio


async def ticking(gate: asyncio.Event, out: list[str]) -> AsyncIterator[str]:
    yield "a"
    await gate.wait()
    out.append("kept going")
    yield "b"


async def test_a_dropped_follower_leaves_the_run_going() -> None:
    gate, out = asyncio.Event(), []
    run = live_runs.start("t-drop", "assistant", "u1", ticking(gate, out))
    follower = run.follow(0)
    assert await anext(follower) == "a"
    await follower.aclose()  # the connection dropped
    assert live_runs.running("t-drop") is run
    gate.set()
    assert run.task is not None
    await run.task
    assert out == ["kept going"] and run.events == ["a", "b"] and run.done
    # A reconnecting client with one event gets the rest, then the stream ends.
    assert [e async for e in run.follow(1)] == ["b"]
    assert live_runs.running("t-drop") is None and live_runs.get("t-drop") is run


async def test_stop_cancels_the_run() -> None:
    gate, out = asyncio.Event(), []
    run = live_runs.start("t-stop", "assistant", None, ticking(gate, out))
    await asyncio.sleep(0)
    assert await live_runs.stop("t-stop")
    assert run.done and out == [] and not await live_runs.stop("t-stop")


async def test_a_failure_ends_the_stream_with_a_run_error() -> None:
    async def failing() -> AsyncIterator[str]:
        yield "a"
        raise RuntimeError("model down")

    run = live_runs.start("t-fail", "assistant", None, failing())
    events = [e async for e in run.follow(0)]
    assert events[0] == "a" and "RUN_ERROR" in events[1] and "model down" in events[1]


async def test_a_quiet_run_sends_pings_that_are_not_events(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(live_runs, "PING_SECONDS", 0.01)
    gate, out = asyncio.Event(), []
    run = live_runs.start("t-ping", "assistant", "u1", ticking(gate, out))
    follower = run.follow(0)
    assert await anext(follower) == "a"
    assert await anext(follower) == live_runs.PING  # nothing new for a while
    gate.set()
    rest = [e async for e in follower]
    assert [e for e in rest if e != live_runs.PING] == ["b"]
    assert run.events == ["a", "b"]  # pings aren't kept, so `since` still counts events
