"""Checks a deployed agent service's live stream end to end, through whatever proxies sit in front.

Runs one assistant reply that should use sub-agents, follows its stream and reports:
how long it took, the longest silence (keep-alive pings count as traffic), whether each
sub-agent is tied to the `agent` command that started it and closed before the call's result, and how the
run ended. With --rejoin it drops the stream partway and rejoins it from where it
was, as the browser does, and checks nothing was lost or repeated. The probe's chat is
deleted afterwards unless --keep is given.

    AUTH_SECRET=... uv run python scripts/probe_stream.py https://agents.example.com
    AUTH_SECRET=... uv run python scripts/probe_stream.py http://localhost:8080 --rejoin 25

Exits 1 when a check fails. The token is read from AUTH_SECRET and never printed.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import uuid
from collections import Counter
from typing import Any

import httpx

PROMPT = (
    "Use two sub-agents in parallel: a general one to find the current stable Python "
    "version and a research one to find the current Node.js LTS version. Then answer in one line."
)
# Proxies like Cloudflare drop a response that is silent for about this long.
SILENCE_LIMIT = 90.0


def client(base: str) -> httpx.Client:
    token = os.environ.get("AUTH_SECRET")
    headers = {"User-Agent": "agents-stream-probe/1", "Accept": "text/event-stream"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return httpx.Client(
        base_url=base.rstrip("/"), headers=headers, timeout=httpx.Timeout(30, read=600)
    )


class Follower:
    """Reads SSE lines, keeping the events and the longest silence between any two lines."""

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []
        self.pings = 0
        self.longest_silence = 0.0
        self.started = time.monotonic()
        self._last = self.started

    def read(self, response: httpx.Response, stop_after: int | None = None) -> bool:
        """Follows `response`; True if it stopped early at `stop_after` events."""
        for line in response.iter_lines():
            now = time.monotonic()
            self.longest_silence = max(self.longest_silence, now - self._last)
            self._last = now
            if line.startswith(":"):
                self.pings += 1
            elif line.startswith("data:"):
                self.events.append(json.loads(line[5:]))
                if stop_after is not None and len(self.events) >= stop_after:
                    return True
        return False


def check(events: list[dict[str, Any]], follower: Follower) -> list[str]:
    """What's wrong with the run's stream, if anything."""
    problems = []
    types = [e["type"] for e in events]
    if not types or types[-1] != "RUN_FINISHED":
        problems.append(f"run ended with {types[-1] if types else 'nothing'}, not RUN_FINISHED")
    if follower.longest_silence > SILENCE_LIMIT:
        problems.append(f"{follower.longest_silence:.0f}s without a byte; a proxy may cut that")
    started = [e for e in events if e["type"] == "SUBAGENT_STARTED"]
    if not started:
        problems.append("no sub-agent ran (the model may have skipped them; run it again)")
    for e in started:
        call = e.get("parentToolCallId")
        if not call:
            problems.append(f"sub-agent {e.get('name')} isn't tied to the call that started it")
            continue
        closed = next(
            (
                i
                for i, x in enumerate(events)
                if x["type"] in ("SUBAGENT_FINISHED", "SUBAGENT_ERROR")
                and x.get("subagentRunId") == e["subagentRunId"]
            ),
            None,
        )
        result = next(
            (
                i
                for i, x in enumerate(events)
                if x["type"] == "TOOL_CALL_RESULT" and x.get("toolCallId") == call
            ),
            None,
        )
        if closed is None or (result is not None and closed > result):
            problems.append(f"sub-agent {e.get('name')} wasn't closed before its result")
    # Each message and tool call opens and closes once: a lost or repeated event shows here.
    for kind, key in (("TEXT_MESSAGE", "messageId"), ("TOOL_CALL", "toolCallId")):
        opened = Counter(e[key] for e in events if e["type"] == f"{kind}_START")
        ended = Counter(e[key] for e in events if e["type"] == f"{kind}_END")
        if opened != ended or any(n != 1 for n in opened.values()):
            problems.append(
                f"{kind.lower()} starts and ends don't pair up: events lost or repeated"
            )
    problems += [f"RUN_ERROR: {e.get('message')}" for e in events if e["type"] == "RUN_ERROR"]
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("base", help="the agent service's URL")
    parser.add_argument("--agent", default="assistant")
    parser.add_argument("--model", help="a model the service offers; its default otherwise")
    parser.add_argument("--prompt", default=PROMPT)
    parser.add_argument(
        "--user", default="stream-probe", help="the user id the probe's chat belongs to"
    )
    parser.add_argument(
        "--rejoin", type=int, metavar="N", help="drop the stream after N events and rejoin"
    )
    parser.add_argument("--keep", action="store_true", help="keep the probe's chat")
    args = parser.parse_args()

    thread_id = f"probe-{uuid.uuid4().hex[:8]}"
    body = {
        "threadId": thread_id,
        "runId": str(uuid.uuid4()),
        "state": {},
        "tools": [],
        "context": [],
        "messages": [{"id": str(uuid.uuid4()), "role": "user", "content": args.prompt}],
        "forwardedProps": {"user_id": args.user, **({"model": args.model} if args.model else {})},
    }
    follower = Follower()
    with client(args.base) as http:
        try:
            with http.stream("POST", f"/{args.agent}/ag-ui", json=body) as response:
                response.raise_for_status()
                dropped = follower.read(response, stop_after=args.rejoin)
            if dropped:
                since = len(follower.events)
                with http.stream(
                    "GET", f"/{args.agent}/ag-ui/{thread_id}/live", params={"since": since}
                ) as response:
                    response.raise_for_status()
                    follower.read(response)
                print(f"rejoined at event {since}")
        finally:
            if not args.keep:
                http.request("DELETE", "/thread", json={"thread_id": thread_id})

    events = follower.events
    counts = Counter(e["type"] for e in events)
    print(f"thread {thread_id}{' (kept)' if args.keep else ' (deleted)'}")
    print(
        f"{len(events)} events and {follower.pings} pings in {time.monotonic() - follower.started:.1f}s; "
        f"longest silence {follower.longest_silence:.1f}s"
    )
    print(
        f"sub-agents {counts['SUBAGENT_STARTED']} started, {counts['SUBAGENT_FINISHED']} finished, "
        f"{counts['SUBAGENT_ERROR']} failed"
    )
    problems = check(events, follower)
    for problem in problems:
        print(f"FAIL {problem}")
    if not problems:
        print("OK")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
