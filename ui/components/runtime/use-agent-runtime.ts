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

async function loadThreads(): Promise<ThreadRow[] | null> {
  const res = await fetch("/api/threads");
  return res.ok ? res.json() : null;
}

type Options = {
  defaultAgentId: string;
  defaultModelId: string;
  onError: (error: Error) => void;
  onRunFinalized: () => void;
};

/** One AG-UI runtime for the app: the current thread's agent, plus the user's thread list. */
export function useAgentRuntime({ defaultAgentId, defaultModelId, onError, onRunFinalized }: Options) {
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
      onRunFinalized: () => {
        void refreshThreads();
        finalizedRef.current();
      },
    });
    return unsubscribe;
  }, [agent, refreshThreads]);

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
          if (row.modelId) setModelId(row.modelId);
        }
        const res = await fetch(`/api/threads/${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error(`Could not load the conversation (HTTP ${res.status})`);
        return { messages: historyToThreadMessages((await res.json()) as History) };
      },
      onRename: async (id, title) => {
        await fetch(`/api/threads/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ title }) });
        await refreshThreads();
      },
      onDelete: async (id) => {
        const res = await fetch(`/api/threads/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`Could not delete the conversation (HTTP ${res.status})`);
        setThreads((prev) => prev?.filter((t) => t.id !== id) ?? null);
        if (id === threadId) await runtimeRef.current?.threads.switchToNewThread();
      },
    }),
    [threadId, threads, refreshThreads],
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

  return { runtime, agentId, setAgentId, modelId, setModelId };
}
