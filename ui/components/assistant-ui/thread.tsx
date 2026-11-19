import {
  ActionBarPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowUpRightIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  RefreshCwIcon,
  SparklesIcon,
  SquareIcon,
  Undo2Icon,
} from "lucide-react";
import type { FC } from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AgentSelect } from "@/components/agent-select";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { useChat } from "@/components/custom-runtime-provider";
import { useDialogs } from "@/components/dialogs";
import { InterruptBanner } from "@/components/interrupt-banner";
import { ModelSelect } from "@/components/model-select";
import { SubagentToolCard } from "@/components/subagent-tool-ui";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import agentSuggestions from "./agent-suggestions.json";
import { ConversationSkeleton } from "./loading-skeletons";
import { MarkdownText } from "./markdown-text";
import { ReasoningPart } from "./reasoning";
import { getToolDisplayName, getToolIcon, toolSpacing, ToolRow } from "./tool-fallback";
import { WorkingIndicator } from "./working-indicator";

const MAX_CHARACTERS = 560;

/** Phones and tablets: focusing the composer on load would pop the keyboard over the conversation. */
const isTouch = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

const focusComposer = () =>
  document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message input"]')?.focus();

/** Esc stops a response, ⌘/Ctrl+Shift+O starts a new chat, ⌘/Ctrl+K focuses the message box. */
function useThreadShortcuts() {
  const aui = useAui();
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape" && !e.defaultPrevented && aui.thread().getState().isRunning) {
        // Leave Esc to an open dialog or menu.
        if (document.querySelector('[role="dialog"], [role="listbox"], [role="menu"]')) return;
        e.preventDefault();
        aui.thread().cancelRun();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void aui.threads().switchToNewThread();
        setTimeout(focusComposer, 0);
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        focusComposer();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [aui]);
}

export const Thread: FC = () => {
  useThreadShortcuts();
  return (
    <ThreadPrimitive.Root
      className="bg-background flex h-full w-full min-w-0 flex-col"
      style={{
        ["--thread-max-width" as string]: "46rem",
        ["--thread-padding-x" as string]: "1rem",
      }}
    >
      <ThreadPrimitive.Viewport className="relative flex min-w-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]">
        {/* Messages fade out under the header rather than cutting off at its edge. */}
        <div className="from-background pointer-events-none sticky top-0 z-10 -mb-4 h-4 shrink-0 bg-gradient-to-b to-transparent" />
        <div className="h-4 shrink-0" />
        <ThreadBody />
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        <ThreadPrimitive.If empty={false}>
          <div className="min-h-8 shrink-0" />
        </ThreadPrimitive.If>
      </ThreadPrimitive.Viewport>
      <Composer />
    </ThreadPrimitive.Root>
  );
};

const ThreadScrollToBottom: FC = () => (
  <ThreadPrimitive.ScrollToBottom asChild>
    <TooltipIconButton
      tooltip="Scroll to bottom"
      variant="outline"
      className="bg-background absolute -top-11 z-10 size-8 self-center rounded-full shadow-md disabled:invisible dark:bg-card"
    >
      <ArrowDownIcon />
    </TooltipIconButton>
  </ThreadPrimitive.ScrollToBottom>
);

/** The welcome for a new chat, or a skeleton while a conversation's history loads. */
const ThreadBody: FC = () => {
  const { loadingThread, booting } = useChat();
  const empty = useAuiState((s) => s.thread.messages.length === 0);
  if (!loadingThread) return <ThreadWelcome />;
  // At boot the skeleton is already on screen, so carry it on; a switch waits a beat first.
  return empty ? <ConversationSkeleton delayed={!booting} /> : null;
};

function greeting(now = new Date()) {
  const hour = now.getHours();
  return hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

const ThreadWelcome: FC = () => {
  const { serviceInfo, agentId } = useChat();
  const { data: session } = useSession();
  const agent = serviceInfo.agents.find((a) => a.key === agentId);
  const firstName = session?.user.isAnonymous ? null : session?.user.name?.split(" ")[0];
  const reduceMotion = useReducedMotion();

  return (
    <ThreadPrimitive.Empty>
      <div className="mx-auto flex w-full max-w-[var(--thread-max-width)] flex-grow flex-col justify-center px-[var(--thread-padding-x)] pb-6">
        <motion.div
          initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          <span className="bg-brand-soft text-brand flex size-10 items-center justify-center rounded-xl">
            <SparklesIcon className="size-5" />
          </span>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight md:text-3xl">
            {greeting()}
            {firstName && `, ${firstName}`}
          </h1>
          <p className="text-muted-foreground mt-2 max-w-xl text-[15px] leading-relaxed">
            {agent?.description || "How can I help you today?"}
          </p>
        </motion.div>
      </div>
    </ThreadPrimitive.Empty>
  );
};

const ThreadWelcomeSuggestions: FC = () => {
  const { agentId, loadingThread } = useChat();
  const reduceMotion = useReducedMotion();
  const suggestions =
    agentSuggestions[agentId as keyof typeof agentSuggestions] ?? agentSuggestions["auto-router"];
  if (loadingThread) return null;

  return (
    <div className="grid w-full gap-2 sm:grid-cols-2">
      {suggestions.map((suggestion, index) => (
        <motion.div
          key={`${suggestion.title}-${index}`}
          initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.08 + 0.04 * index }}
          className="[&:nth-child(n+4)]:hidden sm:[&:nth-child(n+4)]:block"
        >
          <ThreadPrimitive.Suggestion prompt={suggestion.action} method="replace" autoSend asChild>
            <button
              type="button"
              aria-label={suggestion.action}
              className="group/suggestion hover:bg-accent/60 focus-visible:ring-ring flex h-full w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left text-sm transition-colors outline-none focus-visible:ring-[3px]"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{suggestion.title}</span>
                <span className="text-muted-foreground mt-0.5 block text-[13px]">{suggestion.label}</span>
              </span>
              <ArrowUpRightIcon className="text-muted-foreground mt-0.5 size-4 shrink-0 opacity-0 transition-opacity group-hover/suggestion:opacity-100 group-focus-visible/suggestion:opacity-100" />
            </button>
          </ThreadPrimitive.Suggestion>
        </motion.div>
      ))}
    </div>
  );
};

const LimitBanner: FC = () => {
  const { limitMessage } = useChat();
  if (!limitMessage) return null;
  return <Alert tone="error">{limitMessage}</Alert>;
};

/** Runs left in the tightest window, e.g. "2/3". */
const UsageCounter: FC = () => {
  const { usage } = useChat();
  const tightest = usage?.reduce<(typeof usage)[number] | null>(
    // On a tie, show the longer window: it says more about what's left.
    (min, w) => (!min || w.limit - w.used <= min.limit - min.used ? w : min),
    null,
  );
  if (!tightest) return null;
  const left = Math.max(0, tightest.limit - tightest.used);
  return (
    <span
      className={cn("text-xs tabular-nums", left === 0 ? "text-destructive" : "text-muted-foreground")}
      title={`${left} of ${tightest.limit} runs left this ${tightest.window}`}
    >
      {left}/{tightest.limit} runs
    </span>
  );
};

const Composer: FC = () => {
  const text = useAuiState((s) => s.composer.text);
  const { limitMessage } = useChat();
  const remaining = MAX_CHARACTERS - text.length;
  const isOverLimit = remaining < 0;
  const isSendDisabled = Boolean(limitMessage) || isOverLimit || text.trim().length === 0;

  return (
    <div className="bg-background relative mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col gap-3 px-[var(--thread-padding-x)] pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-4">
      {/* Messages fade out into the composer rather than cutting off at its edge. */}
      <div className="from-background pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t to-transparent" />
      <ThreadScrollToBottom />
      <ThreadPrimitive.Empty>
        <ThreadWelcomeSuggestions />
      </ThreadPrimitive.Empty>
      <InterruptBanner />
      <LimitBanner />
      <ComposerPrimitive.Root
        className={cn(
          "bg-background dark:bg-card relative flex w-full flex-col rounded-xl border shadow-sm transition-[border-color,box-shadow]",
          "focus-within:border-ring focus-within:ring-ring/25 focus-within:ring-[3px]",
          isOverLimit && "border-destructive focus-within:border-destructive focus-within:ring-destructive/20",
        )}
      >
        <ComposerPrimitive.Input
          placeholder="Ask anything…"
          className="placeholder:text-muted-foreground max-h-[40dvh] min-h-[3.25rem] w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-base outline-none md:text-[15px]"
          rows={1}
          autoFocus={!isTouch()}
          aria-label="Message input"
          submitMode={isSendDisabled ? "none" : "enter"}
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <div className="flex min-w-0 items-center gap-0.5">
            <AgentSelect />
            <ModelSelect />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {text.length > MAX_CHARACTERS - 120 && (
              <span
                className={cn("text-xs tabular-nums", isOverLimit ? "text-destructive" : "text-muted-foreground")}
                title={`${text.length}/${MAX_CHARACTERS} characters`}
              >
                {isOverLimit ? `${-remaining} over` : `${remaining} left`}
              </span>
            )}
            <UsageCounter />
            <ThreadPrimitive.If running={false}>
              <ComposerPrimitive.Send asChild>
                <Button type="submit" size="icon-sm" className="rounded-lg" aria-label="Send message" disabled={isSendDisabled}>
                  <ArrowUpIcon />
                </Button>
              </ComposerPrimitive.Send>
            </ThreadPrimitive.If>
            <ThreadPrimitive.If running>
              <ComposerPrimitive.Cancel asChild>
                <Button type="button" size="icon-sm" className="rounded-lg" aria-label="Stop generating">
                  <SquareIcon className="size-3 fill-current" />
                </Button>
              </ComposerPrimitive.Cancel>
            </ThreadPrimitive.If>
          </div>
        </div>
      </ComposerPrimitive.Root>
      <p className="text-muted-foreground hidden text-center text-[11px] md:block">
        Answers can be wrong. Check anything important.
      </p>
    </div>
  );
};

const MessageError: FC = () => (
  <MessagePrimitive.Error>
    <ErrorPrimitive.Root className="border-destructive/30 bg-destructive/8 text-destructive mt-3 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm">
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
      <ErrorPrimitive.Message className="line-clamp-3" />
    </ErrorPrimitive.Root>
  </MessagePrimitive.Error>
);

const SubagentWrapper: FC<React.ComponentProps<typeof SubagentToolCard>> = (props) => (
  <div data-tool className={cn(toolSpacing, "mb-2")}>
    <SubagentToolCard {...props} />
  </div>
);

const ParallelToolGroup: FC<
  React.PropsWithChildren<{ startIndex: number; endIndex: number }>
> = ({ startIndex, endIndex, children }) => {
  const message = useAuiState((s) => s.message);

  const toolParts = useMemo(() => {
    return message.content
      .slice(startIndex, endIndex + 1)
      .filter((part): part is Extract<typeof part, { type: "tool-call" }> => part.type === "tool-call");
  }, [endIndex, message.content, startIndex]);

  const shouldGroup = useMemo(() => {
    if (toolParts.length <= 1) return false;
    return toolParts.every(
      (part) => part.toolName !== "task" && part.toolName !== "task_update",
    );
  }, [toolParts]);

  if (!shouldGroup) {
    return <>{children}</>;
  }

  const completedCount = toolParts.filter((part) => part.result !== undefined).length;
  const isRunning = completedCount < toolParts.length;
  const groupTools = toolParts.map((part, index) => ({
    key: `${part.toolCallId || part.toolName}-${index}`,
    name: part.toolName,
  }));

  return (
    <details data-tool className={cn("group/tools rounded-md border border-border/60 text-sm open:border-border", toolSpacing)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1 [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
          {groupTools.map((tool) => (
            <span key={tool.key} className="inline-flex items-center gap-1.5 font-medium">
              {getToolIcon(tool.name)}
              {getToolDisplayName(tool.name)}
            </span>
          ))}
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {completedCount}/{toolParts.length}
        </span>
        {isRunning ? (
          <Spinner className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="size-3.5 text-muted-foreground transition-transform duration-300 group-open/tools:rotate-180" />
        )}
      </summary>
      <div className="border-t border-dashed border-border/70 p-1.5 [&_[data-tool]]:mb-0">{children}</div>
    </details>
  );
};

const AssistantMessage: FC = () => {
  const hasBody = useAuiState((s) =>
    s.message.content.some((part) => part.type !== "text" || part.text.trim().length > 0),
  );
  const hasError = useAuiState((s) => s.message.status?.type === "incomplete" && s.message.status.reason === "error");
  // The newest message of a live run, which carries the working indicator.
  const working = useAuiState((s) => s.thread.isRunning && s.message.isLast);
  if (!hasBody && !hasError && !working) return null;

  return (
    <MessagePrimitive.Root asChild>
      <motion.div
        className="group/assistant relative mx-auto w-full max-w-[var(--thread-max-width)] px-[var(--thread-padding-x)] py-3"
        initial={{ y: 4, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        data-role="assistant"
      >
        <div className="text-foreground min-w-0 text-[15px] leading-7 break-words">
          <MessagePrimitive.Content
            components={{
              Text: MarkdownText,
              Reasoning: ReasoningPart,
              tools: { by_name: { task: SubagentWrapper }, Fallback: ToolRow },
              ToolGroup: ParallelToolGroup,
            }}
          />
          {working && <WorkingIndicator />}
          <MessageError />
        </div>
        <AssistantActionBar />
      </motion.div>
    </MessagePrimitive.Root>
  );
};

const CopyAction: FC = () => (
  <ActionBarPrimitive.Copy asChild>
    <TooltipIconButton tooltip="Copy">
      <MessagePrimitive.If copied>
        <CheckIcon />
      </MessagePrimitive.If>
      <MessagePrimitive.If copied={false}>
        <CopyIcon />
      </MessagePrimitive.If>
    </TooltipIconButton>
  </ActionBarPrimitive.Copy>
);

/** True while a run streams or a revert is in flight, when history must not change. */
function useBusy() {
  return useAuiState((s) => s.thread.isRunning);
}

const RegenerateAction: FC = () => {
  const { regenerate, limitMessage } = useChat();
  const busy = useBusy();
  const [pending, setPending] = useState(false);
  // The user message this answer replies to.
  const userMessageId = useAuiState((s) => {
    const index = s.thread.messages.findIndex((m) => m.id === s.message.id);
    return s.thread.messages.slice(0, index).findLast((m) => m.role === "user")?.id;
  });
  if (!userMessageId) return null;

  const onClick = async () => {
    setPending(true);
    try {
      await regenerate(userMessageId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not regenerate the answer.");
    } finally {
      setPending(false);
    }
  };

  return (
    <TooltipIconButton
      tooltip={limitMessage ? "Run limit reached" : "Regenerate"}
      disabled={busy || pending || Boolean(limitMessage)}
      onClick={onClick}
    >
      <RefreshCwIcon className={cn(pending && "animate-spin")} />
    </TooltipIconButton>
  );
};

const AssistantActionBar: FC = () => {
  // Hide the bar on messages that only hold tool calls.
  const hasTextContent = useAuiState((s) =>
    s.message.content.some((part) => part.type === "text" && part.text.trim().length > 0),
  );
  const isLast = useAuiState((s) => s.message.isLast);
  if (!hasTextContent) return null;

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
      // aui-assistant-action-bar-root
      className="text-muted-foreground data-floating:bg-background -ml-1.5 mt-1 flex gap-0.5 data-floating:absolute data-floating:rounded-md data-floating:border data-floating:p-0.5 data-floating:shadow-sm"
    >
      <CopyAction />
      {isLast && <RegenerateAction />}
    </ActionBarPrimitive.Root>
  );
};

const UndoAction: FC = () => {
  const { undo } = useChat();
  const { confirm } = useDialogs();
  const busy = useBusy();
  const [pending, setPending] = useState(false);
  const messageId = useAuiState((s) => s.message.id);
  const isLast = useAuiState((s) => s.message.isLast);
  const laterCount = useAuiState((s) => {
    const index = s.thread.messages.findIndex((m) => m.id === s.message.id);
    return s.thread.messages.length - index - 1;
  });

  const onClick = async () => {
    const ok = await confirm({
      title: "Revert to this message?",
      description:
        laterCount > 0 || !isLast
          ? "This message and everything after it will be removed. Its text goes back into the message box so you can change it and send again."
          : "This message will be removed. Its text goes back into the message box so you can change it and send again.",
      confirmLabel: "Revert",
      destructive: true,
    });
    if (!ok) return;
    setPending(true);
    try {
      await undo(messageId);
      toast.success("Conversation reverted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not revert the conversation.");
    } finally {
      setPending(false);
    }
  };

  return (
    <TooltipIconButton tooltip="Revert to here" disabled={busy || pending} onClick={onClick}>
      <Undo2Icon className={cn(pending && "animate-pulse")} />
    </TooltipIconButton>
  );
};

const UserActionBar: FC = () => (
  <ActionBarPrimitive.Root
    autohide="never"
    // Always shown, small until the message is hovered or focused.
    className={cn(
      "text-muted-foreground mt-1 flex origin-top-right justify-end gap-0.5",
      "scale-90 opacity-50 transition-[scale,opacity] duration-200 ease-out motion-reduce:transition-none",
      "group-hover/user:scale-100 group-hover/user:opacity-100 focus-within:scale-100 focus-within:opacity-100",
    )}
  >
    <CopyAction />
    <UndoAction />
  </ActionBarPrimitive.Root>
);

const UserMessage: FC = () => (
  <MessagePrimitive.Root asChild>
    <motion.div
      className="group/user mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col items-end px-[var(--thread-padding-x)] py-3"
      initial={{ y: 4, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      data-role="user"
    >
      <div className="bg-muted text-foreground max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-[15px] leading-relaxed break-words">
        <MessagePrimitive.Content components={{ Text: MarkdownText }} />
      </div>
      <UserActionBar />
    </motion.div>
  </MessagePrimitive.Root>
);
