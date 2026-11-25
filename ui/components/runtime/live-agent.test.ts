import { lastValueFrom, toArray } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import type { LiveAgent } from "./live-agent";
import { agent, events, frame, input, sse, sseBody } from "./test-stream";

const run = (a: LiveAgent) => lastValueFrom(a.run(input()).pipe(toArray()));

describe("LiveAgent", () => {
  it("passes the backend's stream through as it was sent", async () => {
    const { agent: a } = agent(() => sse(sseBody(events.map(frame))));
    expect(await run(a)).toEqual(events);
  });

  it("ignores keep-alive pings between events", async () => {
    const chunks = events.flatMap((e, i) => (i % 5 === 0 ? [": ping\n\n", frame(e)] : [frame(e)]));
    const { agent: a } = agent(() => sse(sseBody(chunks)));
    expect(await run(a)).toEqual(events);
  });

  it("rejoins a dropped stream from the last event it had, with nothing lost or repeated", async () => {
    // Cut mid-run, and mid-frame: the half-sent event comes again on the rejoin.
    const at = 17;
    const { agent: a, fetch } = agent((url) => {
      if (!url.includes("/run/stream")) {
        const half = frame(events[at]).slice(0, 20);
        return sse(sseBody([...events.slice(0, at).map(frame), half], true));
      }
      const since = Number(new URL(url, "http://ui").searchParams.get("since"));
      return sse(sseBody(events.slice(since).map(frame)));
    });
    expect(await run(a)).toEqual(events);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/ag-ui/assistant",
      `/api/threads/thread-1/run/stream?since=${at}`,
    ]);
  });

  it("rejoins a stream that closed before the run ended", async () => {
    const { agent: a } = agent((url) =>
      url.includes("/run/stream")
        ? sse(sseBody(events.slice(10).map(frame)))
        : sse(sseBody(events.slice(0, 10).map(frame))),
    );
    expect(await run(a)).toEqual(events);
  });

  it("stops following when the run is gone, and says so", async () => {
    const lost = vi.fn();
    const { agent: a } = agent((url) =>
      url.includes("/run/stream") ? new Response(null, { status: 404 }) : sse(sseBody(events.slice(0, 5).map(frame), true)),
    );
    a.whenLost(lost);
    expect(await run(a)).toEqual(events.slice(0, 5));
    expect(lost).toHaveBeenCalledWith("thread-1");
  });
});
