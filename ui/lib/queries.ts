import { QueryClient, queryOptions } from "@tanstack/react-query";
import { historyToThreadMessages } from "@/lib/agui-history";
import type { Catalog } from "@/lib/commands";
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

/** Long enough for a cold backend; past it a request fails (and can be retried) rather than hanging. */
const REQUEST_TIMEOUT_MS = 20_000;

async function getJson<T>(url: string, what: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (error) {
    if (timeout.aborted) throw new Error(`Loading ${what} timed out`);
    throw error;
  }
  if (!res.ok) throw new Error(`Could not load ${what} (HTTP ${res.status})`);
  return res.json() as Promise<T>;
}

export const serviceInfoQuery = queryOptions({
  queryKey: ["service-info"],
  queryFn: ({ signal }) => getJson<ServiceInfo>("/api/service-info", "the agent service", signal),
  retry: 2,
  staleTime: 5 * 60_000,
});

/** The skill catalog, which says how each command's card looks. */
export const skillsQuery = queryOptions({
  queryKey: ["skills"],
  queryFn: ({ signal }) => getJson<Catalog>("/api/skills", "the skills", signal),
  retry: 2,
  staleTime: 10 * 60_000,
});

/** The user's conversations, newest first. */
export const threadsQuery = queryOptions({
  queryKey: ["threads"],
  queryFn: ({ signal }) => getJson<ThreadRow[]>("/api/threads", "your conversations", signal),
});

/** Whether the user has OpenReader connected, which shows the read-aloud button under replies. */
export const speechQuery = queryOptions({
  queryKey: ["speech-available"],
  queryFn: ({ signal }) => getJson<{ available: boolean }>("/api/tts", "speech", signal),
  staleTime: 5 * 60_000,
  retry: false,
});

/** Run-limit windows; empty when none apply. */
export const usageQuery = queryOptions({
  queryKey: ["usage"],
  queryFn: ({ signal }) => getJson<WindowUsage[]>("/api/limits", "your usage", signal),
});

/**
 * A conversation's messages. Hovering a conversation prefetches this, and the
 * newest one loads alongside the list, so opening one is usually instant.
 */
export const historyQuery = (threadId: string) =>
  queryOptions({
    queryKey: ["history", threadId],
    queryFn: async ({ signal }) =>
      historyToThreadMessages(
        await getJson<History>(`/api/threads/${encodeURIComponent(threadId)}`, "the conversation", signal),
      ),
  });

export type Onboarding = {
  /** When the user agreed to the privacy policy (epoch ms), or null. */
  privacyAcceptedAt: number | null;
};

/** What the user has acknowledged; the privacy gate reads it. */
export const onboardingQuery = queryOptions({
  queryKey: ["onboarding"],
  queryFn: ({ signal }) => getJson<Onboarding>("/api/onboarding", "your privacy settings", signal),
  staleTime: Infinity,
});
