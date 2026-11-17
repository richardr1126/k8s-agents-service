"use client";

import { HttpAgent } from "@ag-ui/client";
import { useAgUiRuntime, type AgUiAssistantRuntime, type UseAgUiThreadListAdapter } from "@assistant-ui/react-ag-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { historyToThreadMessages } from "@/lib/agui-history";
import type { History, ThreadRow } from "@/lib/types";

/** Thrown for a 429 from the proxy, so the thread shows the limit message instead of a raw HTTP error. */
export class RunLimitError extends Error {}

async function proxyFetch(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  if (res.status !== 429) return res;
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  throw new RunLimitError(body.message ?? "You've reached your run limit. Try again later.");
}

async function loadHistory(threadId: string) {
  const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}`);
  if (!res.ok) throw new Error(`Could not load the conversation (HTTP ${res.status})`);
  return historyToThreadMessages((await res.json()) as History);
}

/** Reverts the thread to just before a user message; resolves that message's text. */
async function revertThread(threadId: string, messageId: string): Promise<string> {
  const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/revert`, {
    method: "POST",
    body: JSON.stringify({ messageId }),
  });
  if (!res.ok) throw new Error(`Could not revert the conversation (HTTP ${res.status})`);
  return ((await res.json()) as { text: string }).text;
}

async function loadThreads(): Promise<ThreadRow[] | null> {
  const res = await fetch("/api/threads");
  return res.ok ? res.json() : null;
}

type Options = {
  defaultAgentId: string;
  defaultModelId: string;
  /** Models the backend serves now; a thread saved with a retired model falls back to the default. */
  models: string[];
  onError: (error: Error) => void;
  onRunFinalized: () => void;
};

/** One AG-UI runtime for the app: the current thread's agent, plus the user's thread list. */
export function useAgentRuntime({ defaultAgentId, defaultModelId, models, onError, onRunFinalized }: Options) {
  const [threadId, setThreadId] = useState(() => crypto.randomUUID());
  const [agentId, setAgentId] = useState(defaultAgentId);
  const [modelId, setModelId] = useState(defaultModelId);
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  const runtimeRef = useRef<AgUiAssistantRuntime | null>(null);

  const refreshThreads = useCallback(async () => {
    const rows = await loadThreads();
    if (rows) setThreads(rows);
  }, []);

  // The model rides in the URL: the runtime only forwards model context in the body,
  // and the proxy sets forwardedProps itself.
  const agent = useMemo(
    () =>
      new HttpAgent({
        url: `/api/ag-ui/${encodeURIComponent(agentId)}?model=${encodeURIComponent(modelId)}`,
        threadId,
        fetch: proxyFetch,
      }),
    [agentId, modelId, threadId],
  );

  const finalizedRef = useRef(onRunFinalized);
  useEffect(() => {
    finalizedRef.current = onRunFinalized;
  });
  useEffect(() => {
    const { unsubscribe } = agent.subscribe({
      // The proxy has stored the thread by the time the stream starts.
      onRunStartedEvent: () => void refreshThreads(),
      onRunFinalized: ({ input }) => {
        void refreshThreads();
        finalizedRef.current();
        // Without a MESSAGES_SNAPSHOT (the backend sends none), the runtime streams
        // a resumed run into a new assistant message, away from the interrupted
        // sub-agent card. Reload the thread from /history to put the result back.
        if (input.resume?.length) {
          void loadHistory(input.threadId)
            .then((messages) => runtimeRef.current?.thread.reset(messages))
            .catch(onError);
        }
      },
    });
    return unsubscribe;
  }, [agent, refreshThreads, onError]);

  const threadList = useMemo<UseAgUiThreadListAdapter>(
    () => ({
      threadId,
      isLoading: threads === null,
      threads: (threads ?? []).map((t) => ({ status: "regular", id: t.id, title: t.title })),
      onSwitchToNewThread: () => setThreadId(crypto.randomUUID()),
      onSwitchToThread: async (id) => {
        const row = threads?.find((t) => t.id === id);
        setThreadId(id);
        if (row) {
          setAgentId(row.agentId);
          setModelId(row.modelId && models.includes(row.modelId) ? row.modelId : defaultModelId);
        }
        return { messages: await loadHistory(id) };
      },
      onRename: async (id, title) => {
        const res = await fetch(`/api/threads/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ title }) });
        if (!res.ok) throw new Error(`Could not rename the conversation (HTTP ${res.status})`);
        await refreshThreads();
      },
      onDelete: async (id) => {
        const res = await fetch(`/api/threads/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`Could not delete the conversation (HTTP ${res.status})`);
        setThreads((prev) => prev?.filter((t) => t.id !== id) ?? null);
        if (id === threadId) await runtimeRef.current?.threads.switchToNewThread();
      },
    }),
    [threadId, threads, refreshThreads, models, defaultModelId],
  );

  const runtime = useAgUiRuntime({
    agent,
    showThinking: true,
    onError,
    adapters: { threadList },
  });
  useEffect(() => {
    runtimeRef.current = runtime;
  });

  useEffect(() => {
    void loadThreads().then((rows) => setThreads(rows ?? []));
  }, []);

  // Open the most recent conversation once the list first arrives.
  const openedRef = useRef(false);
  useEffect(() => {
    if (threads === null || openedRef.current) return;
    openedRef.current = true;
    if (threads[0]) void runtime.threads.switchToThread(threads[0].id);
  }, [threads, runtime]);

  /** Drops the message and everything after it, then reloads the thread. Resolves the message's text. */
  const revert = useCallback(
    async (messageId: string) => {
      const text = await revertThread(threadId, messageId);
      const messages = await loadHistory(threadId);
      runtimeRef.current?.thread.reset(messages);
      void refreshThreads();
      return text;
    },
    [threadId, refreshThreads],
  );

  /** Reverts to before the message and puts its text back in the composer. */
  const undo = useCallback(
    async (messageId: string) => {
      const text = await revert(messageId);
      runtimeRef.current?.thread.composer.setText(text);
      // Focus once the composer has the text, with the caret at the end.
      setTimeout(() => {
        const box = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message input"]');
        box?.focus();
        box?.setSelectionRange(box.value.length, box.value.length);
      }, 0);
    },
    [revert],
  );

  /** Reverts to before the message and sends it again, for a fresh answer. */
  const regenerate = useCallback(
    async (messageId: string) => {
      const text = await revert(messageId);
      runtimeRef.current?.thread.append({ role: "user", content: [{ type: "text", text }] });
    },
    [revert],
  );

  return { runtime, agentId, setAgentId, modelId, setModelId, threads, undo, regenerate };
}
