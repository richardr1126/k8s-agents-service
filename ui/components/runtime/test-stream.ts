/** Test helpers: the recorded sub-agent stream, served the way the proxy serves it. */
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { vi } from "vitest";
import fixture from "../../../tests/fixtures/stream_assistant_subagents.json";
import { LiveAgent } from "./live-agent";

/** The assistant's recorded stream with two sub-agents (written by the backend's tests). */
export const events = fixture as unknown as BaseEvent[];

const encoder = new TextEncoder();

/** An SSE body of `chunks`; with `cut`, the connection drops after them instead of closing. */
export function sseBody(chunks: string[], cut = false): ReadableStream<Uint8Array> {
  const queue = [...chunks];
  // One chunk per read, so a cut comes after everything before it was read.
  return new ReadableStream({
    pull(controller) {
      const chunk = queue.shift();
      if (chunk !== undefined) controller.enqueue(encoder.encode(chunk));
      else if (cut) controller.error(new TypeError("network error"));
      else controller.close();
    },
  });
}

export const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;

export function sse(body: ReadableStream<Uint8Array>, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

export function input(threadId = "thread-1"): RunAgentInput {
  return { threadId, runId: "run-1", messages: [], tools: [], context: [], state: {}, forwardedProps: {} };
}

/** A LiveAgent whose requests `respond` answers: the run's POST, then each rejoin's GET. */
export function agent(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetch = vi.fn(async (url: string, init: RequestInit) => respond(url, init));
  return { agent: new LiveAgent({ url: "/api/ag-ui/assistant", threadId: "thread-1", fetch }), fetch };
}
