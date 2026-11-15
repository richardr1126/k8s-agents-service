"use client";

import {
  MessagePartPrimitive,
  MessagePrimitive,
  type ThreadMessage,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react";
import { ChevronDownIcon, GlobeIcon, PauseIcon, UserIcon, WorkflowIcon } from "lucide-react";
import { useState, type FC } from "react";
import { MarkdownString } from "@/components/assistant-ui/markdown-string";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { ReasoningPart } from "@/components/assistant-ui/reasoning";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const AGENTS: Record<string, { label: string; icon: FC<{ className?: string }> }> = {
  web: { label: "Web research", icon: GlobeIcon },
  resume: { label: "Resume", icon: UserIcon },
};

type AgUiRunMetadata = { name?: string; description?: string; result?: string };
type Phase = "running" | "done" | "error" | "waiting";

function phaseOf(run: ThreadMessage | undefined, hasResult: boolean, isError: boolean): Phase {
  const status = run?.status?.type;
  if (status === "incomplete" || isError) return "error";
  if (status === "requires-action") return "waiting";
  if (status === "running" || (!run && !hasResult)) return "running";
  return "done";
}

const SubagentMessage: FC = () => (
  <MessagePrimitive.Root className="space-y-2 text-sm leading-6">
    <MessagePrimitive.Content
      components={{ Text: MarkdownText, Reasoning: ReasoningPart, tools: { Fallback: ToolFallback } }}
    />
  </MessagePrimitive.Root>
);

/**
 * The `task` tool call: one sub-agent run. Its own messages arrive nested on the
 * part (live from SUBAGENT_* events, on reload from /history) and render inside.
 */
export const SubagentToolCard: ToolCallMessagePartComponent<{ description?: string; subagent_type?: string }> = ({
  args,
  result,
  isError,
  messages,
}) => {
  const run = messages?.[0];
  const meta = (run?.metadata.custom?.agui ?? {}) as AgUiRunMetadata;
  const type = meta.name ?? args.subagent_type ?? "agent";
  const agent = AGENTS[type] ?? { label: type, icon: WorkflowIcon };
  const phase = phaseOf(run, result !== undefined, Boolean(isError));
  const answer = meta.result ?? (typeof result === "string" ? result : undefined);
  const failure = run?.status?.type === "incomplete" ? run.status.error : undefined;
  const error = failure === undefined || typeof failure === "string" ? failure : JSON.stringify(failure);

  // Open while running, closed once settled, unless the user has toggled it.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? (phase === "running" || phase === "waiting");
  const Icon = agent.icon;

  return (
    <div
      data-subagent={type}
      data-phase={phase}
      className={cn(
        "mb-3 overflow-hidden rounded-lg border border-l-4 border-border/50 bg-muted/10",
        phase === "error" ? "border-l-destructive" : "border-l-primary/60",
      )}
    >
      <button
        type="button"
        onClick={() => setToggled(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 bg-muted/30 px-2.5 py-1.5 text-left"
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-sm font-medium">{agent.label} agent</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {meta.description ?? args.description}
        </span>
        {phase === "running" && <Spinner className="text-muted-foreground" />}
        {phase === "waiting" && <PauseIcon className="size-3.5 text-amber-500" aria-label="Waiting for input" />}
        {phase === "error" && <span className="text-xs text-destructive">failed</span>}
        <ChevronDownIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="border-t border-border/40 p-3">
          <MessagePartPrimitive.Messages>{() => <SubagentMessage />}</MessagePartPrimitive.Messages>
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </div>
      ) : phase === "error" ? (
        <p className="border-t border-border/40 px-3 py-2 text-sm text-destructive">{error ?? answer ?? "The sub-agent failed."}</p>
      ) : answer ? (
        <div className="max-h-48 overflow-y-auto border-t border-border/40 px-3 py-2 text-sm">
          <MarkdownString>{answer}</MarkdownString>
        </div>
      ) : null}
    </div>
  );
};
