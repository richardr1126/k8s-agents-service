"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { RunLimitError, useAgentRuntime } from "@/components/runtime/use-agent-runtime";
import { createQueryClient, historyQuery, serviceInfoQuery, threadsQuery, usageQuery } from "@/lib/queries";
import type { WindowUsage } from "@/lib/run-limits";
import type { ServiceInfo, ThreadRow } from "@/lib/types";

type ChatContextValue = {
  serviceInfo: ServiceInfo;
  agentId: string;
  setAgentId: (id: string) => void;
  modelId: string;
  setModelId: (id: string) => void;
  usage: WindowUsage[] | null;
  limitMessage: string | null;
  /** The user's threads, newest first; null while loading. */
  threads: ThreadRow[] | null;
  /** A conversation's history is loading (or the first one is still opening). */
  loadingThread: boolean;
  /** The first conversation is still opening: the boot skeleton is already up, so keep one showing. */
  booting: boolean;
  undo: (messageId: string) => Promise<void>;
  regenerate: (messageId: string) => Promise<void>;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) throw new Error("useChat must be used inside CustomRuntimeProvider");
  return context;
}

/** Run-limit usage. While a window is full, it checks again when that window resets, so the composer unlocks by itself. */
function useUsage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    ...usageQuery,
    refetchInterval: (query) => {
      const resets = (query.state.data ?? []).filter((w) => w.used >= w.limit).map((w) => Date.parse(w.resetAt));
      if (resets.length === 0) return false;
      const delay = Math.max(0, Math.max(...resets) - Date.now()) + 1_000;
      return delay > 2 ** 31 - 1 ? false : delay;
    },
  });
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: usageQuery.queryKey }), [queryClient]);
  return { usage: data ?? null, refresh };
}

function RuntimeProvider({ serviceInfo, children }: { serviceInfo: ServiceInfo; children: ReactNode }) {
  const { usage, refresh: refreshUsage } = useUsage();
  const [limitMessage, setLimitMessage] = useState<string | null>(null);

  const onError = useCallback((error: Error) => {
    if (error instanceof RunLimitError) setLimitMessage(error.message);
    else toast.error(error.message);
  }, []);

  const { runtime, ...selection } = useAgentRuntime({
    defaultAgentId: serviceInfo.default_agent,
    defaultModelId: serviceInfo.models.includes(serviceInfo.default_model)
      ? serviceInfo.default_model
      : (serviceInfo.models[0] ?? serviceInfo.default_model),
    models: serviceInfo.models,
    onError,
    onRunFinalized: () => void refreshUsage(),
  });

  // Shown, and sending blocked, until every window has room again.
  const fullWindow = usage?.find((w) => w.used >= w.limit);
  const shownLimitMessage = fullWindow ? (fullWindow.message ?? limitMessage) : null;

  return (
    <ChatContext.Provider value={{ serviceInfo, usage, limitMessage: shownLimitMessage, ...selection }}>
      <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
    </ChatContext.Provider>
  );
}

/**
 * Gives the signed-in user a query cache (the caller remounts this per user), loads
 * the service's agents and models, then provides the chat runtime. The conversation
 * list, usage and the newest conversation start loading alongside the service info.
 */
export function CustomRuntimeProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <ServiceLoader fallback={fallback}>{children}</ServiceLoader>
    </QueryClientProvider>
  );
}

function ServiceLoader({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const queryClient = useQueryClient();
  const serviceInfo = useQuery(serviceInfoQuery);
  const { data: threads } = useQuery(threadsQuery);
  useQuery(usageQuery);

  // The newest conversation opens first; fetch it now rather than after the runtime mounts.
  const newest = threads?.[0]?.id;
  useEffect(() => {
    if (newest) void queryClient.prefetchQuery(historyQuery(newest));
  }, [newest, queryClient]);

  useEffect(() => {
    if (serviceInfo.isError) toast.error("Could not reach the agent service.");
  }, [serviceInfo.isError]);

  if (!serviceInfo.data) return fallback;
  return <RuntimeProvider serviceInfo={serviceInfo.data}>{children}</RuntimeProvider>;
}
