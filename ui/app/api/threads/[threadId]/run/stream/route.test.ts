import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let owned: { threadId: string; agent: string } | { status: 401 | 404 } = { threadId: "thread-1", agent: "assistant" };

vi.mock("@/lib/server", () => ({ backendFetch: vi.fn() }));
vi.mock("@/lib/owned-thread", () => ({ ownedThread: vi.fn(async () => owned) }));

const { backendFetch } = await import("@/lib/server");
const { GET } = await import("./route");

function get(query: string, init: { signal?: AbortSignal } = {}) {
  return GET(new NextRequest(`http://ui/api/threads/thread-1/run/stream${query}`, init), {
    params: Promise.resolve({ threadId: "thread-1" }),
  });
}

const sse = (text: string) => new Response(text, { headers: { "Content-Type": "text/event-stream" } });

beforeEach(() => {
  owned = { threadId: "thread-1", agent: "assistant" };
  vi.mocked(backendFetch).mockReset();
});

describe("GET /api/threads/[threadId]/run/stream", () => {
  it("rejoins the running reply from where the browser left off", async () => {
    vi.mocked(backendFetch).mockResolvedValue(sse(': ping\n\ndata: {"type":"RUN_FINISHED"}\n\n'));
    const res = await get("?since=17");
    expect(vi.mocked(backendFetch).mock.calls[0]![0]).toBe("/assistant/ag-ui/thread-1/live?since=17");
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await res.text()).toBe(': ping\n\ndata: {"type":"RUN_FINISHED"}\n\n');
  });

  it.each([["", 0], ["?since=-4", 0], ["?since=abc", 0]])("reads `since` %j as %d", async (query, since) => {
    vi.mocked(backendFetch).mockResolvedValue(sse(""));
    await get(query);
    expect(vi.mocked(backendFetch).mock.calls[0]![0]).toBe(`/assistant/ag-ui/thread-1/live?since=${since}`);
  });

  it("says when no reply is running, so the browser stops retrying", async () => {
    vi.mocked(backendFetch).mockResolvedValue(new Response(null, { status: 404 }));
    expect((await get("?since=3")).status).toBe(404);
  });

  it("only rejoins the user's own thread", async () => {
    owned = { status: 404 };
    expect((await get("?since=0")).status).toBe(404);
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("stops the backend's stream when the browser goes away", async () => {
    vi.mocked(backendFetch).mockResolvedValue(sse(""));
    const browser = new AbortController();
    await get("?since=0", { signal: browser.signal });
    const signal = vi.mocked(backendFetch).mock.calls[0]![1]!.signal!;
    browser.abort();
    expect(signal.aborted).toBe(true);
  });
});
