import type { ThreadMessage } from "@assistant-ui/react";
import { describe, expect, it } from "vitest";
import fixture from "../../tests/fixtures/history_web_subagent.json";
import { historyToThreadMessages } from "./agui-history";
import type { History } from "./types";

const history = fixture as History;

function taskPart(messages: ThreadMessage[]) {
  const parts = messages.flatMap((m) => (m.role === "assistant" ? m.content : []));
  const part = parts.find((p) => p.type === "tool-call" && p.toolName === "task");
  if (part?.type !== "tool-call") throw new Error("no task tool call");
  return part;
}

describe("historyToThreadMessages", () => {
  it("nests the sub-agent's messages under its task tool call", () => {
    const messages = historyToThreadMessages(history);
    // Not joined: the live stream keeps the dispatch and the answer apart too.
    expect(messages.map((m) => [m.role, m.id])).toEqual([
      ["user", "user-1"],
      ["assistant", "main-dispatch-1"],
      ["assistant", "main-answer-1"],
    ]);

    const task = taskPart(messages);
    expect(task.toolCallId).toBe("call_rust_1");
    expect(task.result).toBe("Rust 2.0 shipped in October.");
    expect(task.messages).toHaveLength(1);

    const [run] = task.messages!;
    expect(run.id).toBe("tools:<id-1>");
    expect(run.status).toEqual({ type: "complete", reason: "unknown" });
    expect(run.metadata.custom.agui).toEqual({
      name: "web",
      description: "research rust",
      result: "Rust 2.0 shipped in October.",
    });
    expect(run.content).toMatchObject([
      { type: "tool-call", toolCallId: "<id-3>", toolName: "web_search", result: expect.stringContaining("Stored 1 chunks") },
      { type: "text", text: "Rust 2.0 shipped in October." },
    ]);
  });

  it("keeps sub-agent messages out of the root thread", () => {
    const messages = historyToThreadMessages(history);
    const ids = messages.map((m) => m.id);
    expect(ids).not.toContain("<id-2>");
    expect(ids).not.toContain("web-answer");
    const rootText = messages[2].content.filter((p) => p.type === "text");
    expect(rootText).toEqual([{ type: "text", text: "Summary: Rust 2.0 shipped in October." }]);
  });

  it("marks a failed sub-agent run as an incomplete message with its error", () => {
    const error = "Sub-agent 'web' failed: search backend down";
    const failed: History = {
      messages: history.messages.map((m) =>
        m.role === "tool" && m.toolCallId === "call_rust_1" ? { ...m, content: error, error: "error" } : m,
      ),
      subagents: [{ ...history.subagents[0], status: "error", error }],
    };
    const task = taskPart(historyToThreadMessages(failed));
    const [run] = task.messages!;
    expect(run.status).toEqual({ type: "incomplete", reason: "error", error });
    expect(run.metadata.custom.agui).not.toHaveProperty("result");
    expect(task.result).toBe(error);
  });

  it("nests a run that produced no messages", () => {
    const empty: History = {
      messages: history.messages.filter((m) => !m.subagentRunId),
      subagents: history.subagents,
    };
    const [run] = taskPart(historyToThreadMessages(empty)).messages!;
    expect(run.id).toBe("tools:<id-1>");
    expect(run.content).toEqual([]);
  });

  it("leaves tool calls without a sub-agent run untouched", () => {
    const task = taskPart(historyToThreadMessages({ ...history, subagents: [] }));
    expect(task.messages).toBeUndefined();
  });
});
