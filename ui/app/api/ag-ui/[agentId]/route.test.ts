import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The rows the route reads back for a thread; empty for a new conversation. */
let threadRows: { userId: string }[] = [];
let denial: object | null = null;

vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("@/lib/server", () => ({
  getSession: vi.fn(async () => ({ user: { id: "user-1" } })),
  backendFetch: vi.fn(),
}));
vi.mock("@/lib/run-limits", () => ({ admitRun: vi.fn(async () => denial) }));
vi.mock("@/lib/settings/store", () => ({
  getSettings: vi.fn(async () => ({ values: { enabledModels: [], defaultModel: "m1", autoTitle: false } })),
}));
vi.mock("@/db", () => {
  const chain = { set: () => chain, where: () => chain, values: () => chain, then: (ok: () => void) => ok() };
  return {
    db: {
      select: () => ({ from: () => ({ where: async () => threadRows }) }),
      update: () => chain,
      insert: () => chain,
    },
  };
});

const { backendFetch } = await import("@/lib/server");
const { POST } = await import("./route");

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A backend stream the test writes to as it goes. */
function upstream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
  return {
    response: new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
    send: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
  };
}

function post(body: object, init: { signal?: AbortSignal } = {}) {
  return POST(
    new NextRequest("http://ui/api/ag-ui/assistant?model=m1", { method: "POST", body: JSON.stringify(body), ...init }),
    { params: Promise.resolve({ agentId: "assistant" }) },
  );
}

const run = { threadId: "thread-1", runId: "run-1", messages: [{ role: "user", content: "go" }] };

beforeEach(() => {
  threadRows = [];
  denial = null;
  vi.mocked(backendFetch).mockReset();
});

describe("POST /api/ag-ui/[agentId]", () => {
  it("passes each event through as the backend sends it, pings included", async () => {
    const backend = upstream();
    vi.mocked(backendFetch).mockResolvedValue(backend.response);
    const res = await post(run);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");

    const reader = res.body!.getReader();
    const next = async () => decoder.decode((await reader.read()).value);
    // Each chunk reaches the browser before the backend sends the next: nothing is held back.
    backend.send('data: {"type":"RUN_STARTED"}\n\n');
    expect(await next()).toBe('data: {"type":"RUN_STARTED"}\n\n');
    backend.send(": ping\n\n");
    expect(await next()).toBe(": ping\n\n");
    backend.send('data: {"type":"RUN_FINISHED"}\n\n');
    expect(await next()).toBe('data: {"type":"RUN_FINISHED"}\n\n');
    backend.close();
    expect((await reader.read()).done).toBe(true);
  });

  it("sets who is asking and the model itself, whatever the browser sent", async () => {
    vi.mocked(backendFetch).mockResolvedValue(upstream().response);
    await post({ ...run, forwardedProps: { user_id: "someone-else", model: "other" } });
    const [path, init] = vi.mocked(backendFetch).mock.calls[0]!;
    expect(path).toBe("/assistant/ag-ui");
    expect(JSON.parse(init!.body as string).forwardedProps).toEqual({ user_id: "user-1", model: "m1" });
  });

  it("stops the backend's stream when the browser goes away", async () => {
    vi.mocked(backendFetch).mockResolvedValue(upstream().response);
    const browser = new AbortController();
    await post(run, { signal: browser.signal });
    const signal = vi.mocked(backendFetch).mock.calls[0]![1]!.signal!;
    expect(signal.aborted).toBe(false);
    browser.abort();
    expect(signal.aborted).toBe(true);
  });

  it("refuses another user's thread without reaching the backend", async () => {
    threadRows = [{ userId: "user-2" }];
    expect((await post(run)).status).toBe(404);
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("answers a run over the limit with 429 without reaching the backend", async () => {
    denial = { window: "day", limit: 3, resetAt: "later", message: "Limit reached." };
    const res = await post(run);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "run_limit", message: "Limit reached." });
    expect(backendFetch).not.toHaveBeenCalled();
  });
});
