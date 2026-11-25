// @vitest-environment happy-dom
import { useAgUiRuntime, type AgUiAssistantRuntime } from "@assistant-ui/react-ag-ui";
import type { ThreadMessage } from "@assistant-ui/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { LiveAgent } from "./live-agent";
import { agent, events, frame, sseBody } from "./test-stream";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let unmount: (() => void) | undefined;
afterEach(() => act(() => unmount?.()));

/** The app's runtime around `liveAgent`, outside any UI. */
async function mountRuntime(liveAgent: LiveAgent): Promise<AgUiAssistantRuntime> {
  let runtime: AgUiAssistantRuntime | undefined;
  function Harness() {
    runtime = useAgUiRuntime({ agent: liveAgent, showThinking: true });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
  unmount = () => root.unmount();
  return runtime!;
}

/** Sends "go" and waits for the reply to finish. */
async function reply(liveAgent: LiveAgent): Promise<readonly ThreadMessage[]> {
  const runtime = await mountRuntime(liveAgent);
  await act(async () => {
    runtime.thread.append({ role: "user", content: [{ type: "text", text: "go" }] });
  });
  await act(async () => {
    for (let i = 0; i < 200 && (runtime.thread.getState().isRunning || i < 2); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  });
  expect(runtime.thread.getState().isRunning).toBe(false);
  return runtime.thread.getState().messages;
}

const text = (content: readonly { type: string; text?: string }[]) =>
  content.map((p) => (p.type === "text" ? p.text : "")).join("");

function check(messages: readonly ThreadMessage[]) {
  const parts = messages.flatMap((m) => (m.role === "assistant" ? m.content : []));
  const tasks = parts.flatMap((p) => (p.type === "tool-call" && p.toolName === "task" ? [p] : []));
  expect(tasks.map((t) => [t.toolCallId, t.result])).toEqual([
    ["call_py", "found python"],
    ["call_node", "found node"],
  ]);
  // Each sub-agent's own messages sit on its task call, under its name...
  for (const [task, name, answer] of [
    [tasks[0]!, "general", "found python"],
    [tasks[1]!, "research", "found node"],
  ] as const) {
    const [run, ...rest] = task.messages ?? [];
    expect(rest).toEqual([]);
    expect(run?.metadata.custom?.agui).toMatchObject({ name });
    expect(text(run!.content)).toBe(answer);
  }
  // ...and none of them is in the main reply, which is the assistant's own answer.
  const main = parts.filter((p) => p.type === "text").map((p) => (p.type === "text" ? p.text : ""));
  expect(main).toEqual(["both found"]);
}

describe("a reply with sub-agents", () => {
  it("shows each sub-agent's messages in its own task card", async () => {
    const { agent: a } = agent(() => new Response(sseBody(events.map(frame))));
    check(await reply(a));
  });

  it("does the same when the stream drops mid-run and rejoins", async () => {
    const { agent: a } = agent((url) => {
      if (!url.includes("/run/stream")) return new Response(sseBody(events.slice(0, 20).map(frame), true));
      const since = Number(new URL(url, "http://ui").searchParams.get("since"));
      return new Response(sseBody(events.slice(since).map(frame)));
    });
    check(await reply(a));
  });
});
