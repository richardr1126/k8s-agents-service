"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangleIcon, CheckCircle2Icon, ChevronDownIcon, HourglassIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useChat } from "@/components/custom-runtime-provider";
import { MarkdownString } from "@/components/assistant-ui/markdown-string";
import { isPodcast, PodcastView } from "@/components/podcast-view";
import { ToolRow, toolSpacing } from "@/components/assistant-ui/tool-fallback";
import { Fold } from "@/components/ui/fold";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type Job = {
  id: string;
  workflow: string;
  thread_id: string | null;
  status: "running" | "done" | "error";
  progress: string;
  result: string | null;
  error: string | null;
  data: Record<string, unknown>;
  /** The agent has been told how the job ended. */
  notified: boolean;
  /** The backend is replying to this job on its thread, or about to. */
  answering?: boolean;
  created_at: string;
  updated_at: string;
};

const JOB_ID = /Started background job `(job-[a-f0-9]{12})`/;

/** Jobs whose reply this page has shown, so a card remounted by the reload doesn't reload again. */
const shown = new Set<string>();

/**
 * When the job ends, the backend replies to it on its thread. While it does, the
 * conversation takes no messages; once the reply is saved, the thread reloads to show it.
 */
function useFollowUp(job: Job | undefined) {
  const { setAnswering, reloadThread } = useChat();
  // Saw the job before the agent heard about it, so its reply is news to this page.
  const live = useRef(false);
  useEffect(() => {
    if (!job?.thread_id) return;
    if (job.status === "running" || job.answering || !job.notified) live.current = true;
    if (job.status === "running") return;
    setAnswering(job.id, job.answering ? job.thread_id : null);
    if (!job.answering && job.notified && live.current && !shown.has(job.id)) {
      shown.add(job.id);
      reloadThread(job.thread_id);
    }
  }, [job, setAnswering, reloadThread]);
  const id = job?.id;
  useEffect(() => () => void (id && setAnswering(id, null)), [id, setAnswering]);
}

/** Polls left after a job ends unanswered: the backend may be about to start its reply. */
const SETTLE_POLLS = 3;

/** The job id a tool result started, if it started one. */
export function jobIdOf(result: unknown): string | null {
  return typeof result === "string" ? (result.match(JOB_ID)?.[1] ?? null) : null;
}

async function fetchJob(id: string): Promise<Job> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(res.status === 404 ? "This job is gone." : `Couldn't load the job (HTTP ${res.status}).`);
  return (await res.json()) as Job;
}

/** A background job: live progress while it runs, then its result. */
export function JobCard({ id, title }: { id: string; title: string }) {
  const settle = useRef(SETTLE_POLLS);
  const { data: job, error } = useQuery({
    queryKey: ["job", id],
    queryFn: () => fetchJob(id),
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data || data.status === "running") return 2500;
      if (data.answering) return 2000;
      // Unanswered: a reply may be starting, or it waits for the user's next message (over the hourly cap).
      if (!data.notified && settle.current > 0) {
        settle.current -= 1;
        return 1500;
      }
      return false;
    },
    retry: 1,
  });
  useFollowUp(job);
  const [open, setOpen] = useState<boolean | null>(null);
  const status = error ? "error" : (job?.status ?? "running");
  const expanded = open ?? status === "done";
  const elapsed = job ? Math.max(0, Math.round((Date.parse(job.updated_at) - Date.parse(job.created_at)) / 1000)) : 0;

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 text-sm">
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
      >
        {status === "running" ? (
          <HourglassIcon className="text-brand size-4 shrink-0" />
        ) : status === "done" ? (
          <CheckCircle2Icon className="size-4 shrink-0 text-green-600 dark:text-green-400" />
        ) : (
          <AlertTriangleIcon className="text-destructive size-4 shrink-0" />
        )}
        <span className="shrink-0 font-medium">{title}</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {error
            ? error.message
            : status === "running"
              ? `${(job?.progress ?? "Starting").replace(/…$/, "")}…`
              : status === "error"
                ? (job?.error ?? "Failed")
                : `Done in ${elapsed < 90 ? `${elapsed}s` : `${Math.round(elapsed / 60)} min`}`}
        </span>
        <span className="ml-auto flex shrink-0 items-center pl-1 text-muted-foreground">
          {status === "running" ? (
            <Spinner className="size-3.5" />
          ) : (
            <ChevronDownIcon className={cn("size-3.5 transition-transform duration-300", expanded && "rotate-180")} />
          )}
        </span>
      </button>
      {job?.status === "done" && (
        <Fold open={expanded}>
          <div className="space-y-3 border-t border-dashed border-border/70 px-3 py-3">
            {isPodcast(job.data.podcast) && <PodcastView podcast={job.data.podcast} />}
            {job.result && (
              <div className="max-h-[32rem] overflow-y-auto text-[15px] leading-7 [&_h1]:mb-3 [&_h1]:text-xl [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-lg [&_h3]:mt-4 [&_h3]:text-base">
                <MarkdownString>{job.result}</MarkdownString>
              </div>
            )}
          </div>
        </Fold>
      )}
    </div>
  );
}

const TITLES: Record<string, string> = {
  "research.deep": "Research report",
  "papers.podcast": "Paper podcast",
};

/** `run_workflow`: a job card when the workflow started a background job, else a plain tool row. */
export const WorkflowTool: ToolCallMessagePartComponent<{ workflow?: string }> = (props) => {
  const id = jobIdOf(props.result);
  if (!id) return <ToolRow {...props} />;
  const workflow = props.args.workflow ?? "";
  return (
    <div data-tool className={cn(toolSpacing, "mb-2")}>
      <JobCard id={id} title={TITLES[workflow] ?? workflow} />
    </div>
  );
};

