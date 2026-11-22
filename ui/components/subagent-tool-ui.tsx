"use client";

import {
  MessagePartPrimitive,
  MessagePrimitive,
  type ThreadMessage,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import { ChevronDownIcon, GitBranchIcon, GlobeIcon, PauseIcon, SearchIcon, SparklesIcon, UserIcon, WorkflowIcon } from "lucide-react";
import { useState, type FC } from "react";
import { MarkdownString } from "@/components/assistant-ui/markdown-string";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { ReasoningPart } from "@/components/assistant-ui/reasoning";
import { ToolRow } from "@/components/assistant-ui/tool-fallback";
import { Fold } from "@/components/ui/fold";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const AGENTS: Record<string, { label: string; icon: FC<{ className?: string }> }> = {
  web: { label: "Web research", icon: GlobeIcon },
  resume: { label: "Resume", icon: UserIcon },
  general: { label: "Sub-agent", icon: SparklesIcon },
  richard: { label: "About Richard", icon: UserIcon },
  research: { label: "Research", icon: SearchIcon },
  github: { label: "GitHub", icon: GitBranchIcon },
};

type AgUiRunMetadata = { name?: string; description?: string; result?: string };
type Phase = "running" | "done" | "error" | "waiting" | "stopped";

function phaseOf(run: ThreadMessage | undefined, hasResult: boolean, isError: boolean): Phase {
  const status = run?.status;
  if (status?.type === "incomplete" && status.reason === "cancelled") return "stopped";
  if (status?.type === "incomplete" || isError) return "error";
  if (status?.type === "requires-action") return "waiting";
  if (status?.type === "running" || (!run && !hasResult)) return "running";
  return "done";
}

const SubagentMessage: FC = () => (
  <MessagePrimitive.Root className="text-sm leading-6">
    <MessagePrimitive.Content
      components={{ Text: MarkdownText, Reasoning: ReasoningPart, tools: { Fallback: ToolRow } }}
    />
  </MessagePrimitive.Root>
);

/**
 * The `task` tool call: one sub-agent run. Its own messages arrive nested on the
 * part (live from SUBAGENT_* events, on reload from /history) and render inside.
 */
export const SubagentToolCard: ToolCallMessagePartComponent<{
  description?: string;
  subagent_type?: string;
  focus?: string;
  thread_id?: string;
}> = ({
  args,
  result,
  isError,
  messages,
}) => {
  const run = messages?.[0];
  const meta = (run?.metadata.custom?.agui ?? {}) as AgUiRunMetadata;
  const type = meta.name ?? args.subagent_type ?? args.focus ?? (args.description ? "general" : "agent");
  const agent = AGENTS[type] ?? { label: type, icon: WorkflowIcon };
  const phase = phaseOf(run, result !== undefined, Boolean(isError));
  const answer = meta.result ?? (typeof result === "string" ? result : undefined);
  const failure = phase === "error" && run?.status?.type === "incomplete" ? run.status.error : undefined;
  const error = failure === undefined || typeof failure === "string" ? failure : JSON.stringify(failure);

  // Open while running, closed once settled, unless the user has toggled it.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const settled = phase !== "running" && phase !== "waiting";
  const open = toggled ?? !settled;
  const steps = run?.content.filter((part) => part.type === "tool-call").length ?? 0;
  const failedText = error ?? answer ?? "The sub-agent failed.";
  const Icon = agent.icon;

  return (
    <div
      data-subagent={type}
      data-phase={phase}
      className={cn(
        "overflow-hidden rounded-xl border",
        phase === "error" ? "border-destructive/30 bg-destructive/5" : "border-subagent-border bg-subagent",
      )}
    >
      <button
        type="button"
        onClick={() => setToggled(!open)}
        aria-expanded={open}
        title={open ? "Show only the result" : "Show the full run"}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-subagent-border/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <Icon className="size-4 shrink-0 text-subagent-accent" />
        <span className="shrink-0 text-sm font-medium">{agent.label} agent</span>
        {args.thread_id && (
          <span
            title="Continues this agent's previous conversation"
            className="shrink-0 rounded-full border border-subagent-border px-1.5 text-[10px] leading-4 text-subagent-accent"
          >
            follow-up
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {meta.description ?? args.description}
        </span>
        {settled && steps > 0 && (
          <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline">
            {steps} tool {steps === 1 ? "call" : "calls"}
          </span>
        )}
        {phase === "running" && <Spinner className="text-muted-foreground" />}
        {phase === "waiting" && <PauseIcon className="size-3.5 text-warning" aria-label="Waiting for input" />}
        {phase === "error" && <span className="text-xs text-destructive">failed</span>}
        {phase === "stopped" && <span className="text-xs text-muted-foreground">stopped</span>}
        <ChevronDownIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-300", open && "rotate-180")} />
      </button>

      {/* The full run, tool calls included. Kept mounted so it can fold away smoothly;
          when the run finishes on its own it lingers a moment first. */}
      <Fold open={open} delayClose={toggled === null}>
        <div className="border-t border-subagent-border/70 p-3">
          <MessagePartPrimitive.Messages>{() => <SubagentMessage />}</MessagePartPrimitive.Messages>
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </div>
      </Fold>

      {/* What the main agent got back. */}
      <Fold open={!open && (phase === "error" || Boolean(answer))} delayOpen={toggled === null}>
        {phase === "error" ? (
          <p className="border-t border-subagent-border/70 px-3 py-2 text-sm text-destructive">{failedText}</p>
        ) : (
          <div className="max-h-48 overflow-y-auto border-t border-subagent-border/70 px-3 py-2 text-sm">
            <MarkdownString>{answer ?? ""}</MarkdownString>
          </div>
        )}
      </Fold>

    </div>
  );
};
