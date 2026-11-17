"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { RunLimitError, useAgentRuntime } from "@/components/runtime/use-agent-runtime";
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
  undo: (messageId: string) => Promise<void>;
  regenerate: (messageId: string) => Promise<void>;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) throw new Error("useChat must be used inside CustomRuntimeProvider");
  return context;
}

async function loadUsage(): Promise<WindowUsage[] | null> {
  const res = await fetch("/api/limits");
  return res.ok ? res.json() : null;
}

function useUsage() {
  const [usage, setUsage] = useState<WindowUsage[] | null>(null);
  const refresh = useCallback(async () => setUsage(await loadUsage()), []);
  useEffect(() => {
    void loadUsage().then(setUsage);
  }, []);
  // While a window is full, check again when it resets so the composer unlocks by itself.
  useEffect(() => {
    const resets = (usage ?? []).filter((w) => w.used >= w.limit).map((w) => Date.parse(w.resetAt));
    if (resets.length === 0) return;
    const delay = Math.max(0, Math.max(...resets) - Date.now()) + 1_000;
    if (delay > 2 ** 31 - 1) return;
    const timer = setTimeout(() => void refresh(), delay);
    return () => clearTimeout(timer);
  }, [usage, refresh]);
  return { usage, refresh };
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

/** Loads the service's agents and models, then provides the chat runtime. */
export function CustomRuntimeProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo | null>(null);
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/service-info");
      if (res.ok) setServiceInfo(await res.json());
      else toast.error("Could not reach the agent service.");
    })();
  }, []);
  if (!serviceInfo) return fallback;
  return <RuntimeProvider serviceInfo={serviceInfo}>{children}</RuntimeProvider>;
}
