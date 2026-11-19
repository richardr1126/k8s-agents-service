import { QueryClient, queryOptions } from "@tanstack/react-query";
import { historyToThreadMessages } from "@/lib/agui-history";
import type { WindowUsage } from "@/lib/run-limits";
import type { History, ServiceInfo, ThreadRow } from "@/lib/types";

/** Chat data the browser reads. One client per signed-in user, so nothing leaks across a sign-in. */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    },
  });
}

async function getJson<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${what} (HTTP ${res.status})`);
  return res.json() as Promise<T>;
}

export const serviceInfoQuery = queryOptions({
  queryKey: ["service-info"],
  queryFn: () => getJson<ServiceInfo>("/api/service-info", "the agent service"),
  staleTime: 5 * 60_000,
});

/** The user's conversations, newest first. */
export const threadsQuery = queryOptions({
  queryKey: ["threads"],
  queryFn: () => getJson<ThreadRow[]>("/api/threads", "your conversations"),
});

/** Run-limit windows; empty when none apply. */
export const usageQuery = queryOptions({
  queryKey: ["usage"],
  queryFn: () => getJson<WindowUsage[]>("/api/limits", "your usage"),
});

/**
 * A conversation's messages. Hovering a conversation prefetches this, and the
 * newest one loads alongside the list, so opening one is usually instant.
 */
export const historyQuery = (threadId: string) =>
  queryOptions({
    queryKey: ["history", threadId],
    queryFn: async () =>
      historyToThreadMessages(
        await getJson<History>(`/api/threads/${encodeURIComponent(threadId)}`, "the conversation"),
      ),
  });
