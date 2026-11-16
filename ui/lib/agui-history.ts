import { fromThreadMessageLike, type ThreadMessage, type ThreadMessageLike } from "@assistant-ui/react";
import { fromAgUiMessages } from "@assistant-ui/react-ag-ui";
import type { History, SubagentRun } from "@/lib/types";

const COMPLETE = { type: "complete", reason: "unknown" } as const;
const OPTIONS = { showThinking: true };

type Part = Exclude<ThreadMessageLike["content"], string>[number];

/**
 * The sub-agent's messages as one assistant message, shaped like the one the
 * live stream builds (id = subagentRunId, metadata.custom.agui), so the tool
 * card renders a reloaded thread the same way it rendered the live run.
 */
function subagentMessage(run: SubagentRun, messages: History["messages"], result: unknown): ThreadMessage {
  const content = fromAgUiMessages(messages, OPTIONS)
    .filter((m) => m.role === "assistant")
    .flatMap((m) => (typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content));
  const failed = run.status === "error";
  return fromThreadMessageLike(
    {
      id: run.subagentRunId,
      role: "assistant",
      content,
      status: failed ? { type: "incomplete", reason: "error", error: run.error ?? "Sub-agent failed" } : COMPLETE,
      metadata: {
        custom: {
          agui: {
            name: run.name,
            description: run.description,
            ...(!failed && typeof result === "string" ? { result } : {}),
          },
        },
      },
    },
    run.subagentRunId,
    COMPLETE,
  );
}

/** Converts POST /history into thread messages, nesting each sub-agent run under its `task` tool call. */
export function historyToThreadMessages(history: History): ThreadMessage[] {
  const byRun = new Map<string, History["messages"]>();
  const root: History["messages"] = [];
  for (const message of history.messages) {
    if (!message.subagentRunId) root.push(message);
    else byRun.set(message.subagentRunId, [...(byRun.get(message.subagentRunId) ?? []), message]);
  }
  const runsByToolCall = Map.groupBy(history.subagents, (run) => run.parentToolCallId);

  const nest = (part: Part): Part => {
    if (part.type !== "tool-call" || !part.toolCallId) return part;
    const runs = runsByToolCall.get(part.toolCallId);
    if (!runs) return part;
    return { ...part, messages: runs.map((run) => subagentMessage(run, byRun.get(run.subagentRunId) ?? [], part.result)) };
  };

  return fromAgUiMessages(root, OPTIONS).map((like, index) =>
    fromThreadMessageLike(
      typeof like.content === "string" ? like : { ...like, content: like.content.map(nest) },
      like.id ?? `history-${index}`,
      COMPLETE,
    ),
  );
}
