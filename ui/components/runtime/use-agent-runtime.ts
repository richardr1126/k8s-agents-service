"use client";

import { HttpAgent } from "@ag-ui/client";
import { useAgUiRuntime, type AgUiAssistantRuntime, type UseAgUiThreadListAdapter } from "@assistant-ui/react-ag-ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { splitMode } from "@/lib/modes";
import { historyQuery, threadsQuery } from "@/lib/queries";
import type { ThreadRow } from "@/lib/types";
import { HAD_THREADS_COOKIE } from "@/lib/utils";

/** Thrown for a 429 from the proxy, so the thread shows the limit message instead of a raw HTTP error. */
export class RunLimitError extends Error {}

async function proxyFetch(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  if (res.status !== 429) return res;
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  throw new RunLimitError(body.message ?? "You've reached your run limit. Try again later.");
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

/** Remembers whether the user has conversations, so the server renders the matching boot skeleton next time. */
function rememberHadThreads(value: boolean) {
  document.cookie = `${HAD_THREADS_COOKIE}=${value ? 1 : 0}; path=/; max-age=31536000; samesite=lax`;
}

const NO_THREADS: ThreadRow[] = [];

type Options = {
  defaultAgentId: string;
  defaultModelId: string;
  /** Models the backend serves now; a thread saved with a retired model falls back to the default. */
  models: string[];
  /** Agents kept only for old chats; a new chat started from one goes back to the default. */
  deprecatedAgents: string[];
  onError: (error: Error) => void;
  onRunFinalized: () => void;
};

/** One AG-UI runtime for the app: the current thread's agent, plus the user's thread list. */
export function useAgentRuntime({ defaultAgentId, defaultModelId, models, deprecatedAgents, onError, onRunFinalized }: Options) {
  const [threadId, setThreadId] = useState(() => crypto.randomUUID());
  const [agentId, setAgentId] = useState(defaultAgentId);
  const [modelId, setModelId] = useState(defaultModelId);
  const queryClient = useQueryClient();
  const threadsResult = useQuery(threadsQuery);
  // A failed list reads as empty, so the app still opens on a new chat.
  const threads: ThreadRow[] | null = threadsResult.data ?? (threadsResult.isError ? NO_THREADS : null);
  /** The conversation whose history is loading, so the thread shows a skeleton instead of the welcome. */
  const [opening, setOpening] = useState<string | null>(null);
  /** Until the first conversation is open (or there is none), the thread shows a skeleton, not the welcome. */
  const [boot, setBoot] = useState<"waiting" | "opening" | "done">("waiting");
  if (boot === "waiting" && threads !== null) setBoot(threads.length > 0 ? "opening" : "done");
  const runtimeRef = useRef<AgUiAssistantRuntime | null>(null);

  const refreshThreads = useCallback(
    () => queryClient.invalidateQueries({ queryKey: threadsQuery.queryKey }),
    [queryClient],
  );
  /** The thread's messages as stored now, skipping the cache: after a run or a revert it is out of date. */
  const loadHistory = useCallback(
    (id: string) => queryClient.fetchQuery({ ...historyQuery(id), staleTime: 0 }),
    [queryClient],
  );

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
      onRunStartedEvent: ({ input }) => {
        void refreshThreads();
        void queryClient.invalidateQueries({ queryKey: historyQuery(input.threadId).queryKey });
      },
      onRunFinalized: ({ input }) => {
        void refreshThreads();
        void queryClient.invalidateQueries({ queryKey: historyQuery(input.threadId).queryKey });
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
  }, [agent, refreshThreads, loadHistory, queryClient, onError]);

  const threadList = useMemo<UseAgUiThreadListAdapter>(
    () => ({
      threadId,
      isLoading: threads === null,
      threads: (threads ?? []).map((t) => ({ status: "regular", id: t.id, title: t.title })),
      onSwitchToNewThread: () => {
        setOpening(null);
        setThreadId(crypto.randomUUID());
        setAgentId((current) => (deprecatedAgents.includes(splitMode(current).agentId) ? defaultAgentId : current));
      },
      onSwitchToThread: async (id) => {
        const row = threads?.find((t) => t.id === id);
        setOpening(id);
        setThreadId(id);
        if (row) {
          setAgentId(row.agentId);
          setModelId(row.modelId && models.includes(row.modelId) ? row.modelId : defaultModelId);
        }
        try {
          // Cached when the conversation was hovered, opened lately or is the newest.
          return { messages: await queryClient.fetchQuery(historyQuery(id)) };
        } finally {
          // The runtime applies the messages after this resolves, so clear the flag a task
          // later or the welcome flashes in between. A later switch owns it by then; leave it.
          setTimeout(() => setOpening((current) => (current === id ? null : current)), 0);
        }
      },
      onRename: async (id, title) => {
        const res = await fetch(`/api/threads/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ title }) });
        if (!res.ok) throw new Error(`Could not rename the conversation (HTTP ${res.status})`);
        await refreshThreads();
      },
      onDelete: async (id) => {
        const res = await fetch(`/api/threads/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`Could not delete the conversation (HTTP ${res.status})`);
        queryClient.setQueryData(threadsQuery.queryKey, (prev) => prev?.filter((t) => t.id !== id));
        queryClient.removeQueries({ queryKey: historyQuery(id).queryKey });
        if (id === threadId) await runtimeRef.current?.threads.switchToNewThread();
      },
    }),
    [threadId, threads, refreshThreads, models, defaultModelId, defaultAgentId, deprecatedAgents, queryClient],
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

  // Open the most recent conversation once the list first arrives.
  const openedRef = useRef(false);
  useEffect(() => {
    if (threads === null || openedRef.current) return;
    openedRef.current = true;
    rememberHadThreads(threads.length > 0);
    if (!threads[0]) return;
    void runtime.threads
      .switchToThread(threads[0].id)
      .catch(onError)
      .finally(() => setBoot("done"));
  }, [threads, runtime, onError]);

  const threadIdRef = useRef(threadId);
  useEffect(() => {
    threadIdRef.current = threadId;
  });

  /**
   * Drops the message and everything after it, then reloads the thread.
   * Resolves the message's text, whether this thread is still open, and
   * whether the transcript was reloaded. A failed reload never repeats the revert.
   */
  const revert = useCallback(
    async (messageId: string) => {
      const origin = threadId;
      const text = await revertThread(origin, messageId);
      const open = () => threadIdRef.current === origin;
      let synced = false;
      try {
        const messages = await loadHistory(origin);
        if (open()) {
          runtimeRef.current?.thread.reset(messages);
          synced = true;
        }
      } catch {
        toast.error("Reverted, but the conversation didn't reload. Reopen it to see the change.");
      }
      void refreshThreads();
      return { text, open: open(), synced };
    },
    [threadId, refreshThreads, loadHistory],
  );

  /** Reverts to before the message and puts its text back in the composer. */
  const undo = useCallback(
    async (messageId: string) => {
      const { text, open } = await revert(messageId);
      // Another conversation was opened meanwhile; leave its composer alone.
      if (!open) return;
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
      const { text, open, synced } = await revert(messageId);
      if (open && synced) runtimeRef.current?.thread.append({ role: "user", content: [{ type: "text", text }] });
    },
    [revert],
  );

  const booting = boot !== "done";
  const loadingThread = booting || opening !== null;
  return { runtime, agentId, setAgentId, modelId, setModelId, threads, loadingThread, booting, undo, regenerate };
}
