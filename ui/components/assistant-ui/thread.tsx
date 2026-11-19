import {
  ActionBarPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowDownIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  RefreshCwIcon,
  SendHorizontalIcon,
  Square,
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
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
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
      className="bg-background flex h-full w-full min-w-0 flex-col pb-2 sm:pb-0"
      style={{
        ["--thread-max-width" as string]: "48rem",
        ["--thread-padding-x" as string]: "0.7rem",
      }}
    >
      <ThreadPrimitive.Viewport className="relative flex min-w-0 flex-1 flex-col gap-0 overflow-y-scroll pt-8">
        <ThreadBody />
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        <ThreadPrimitive.If empty={false}>
          <motion.div className="min-h-6 min-w-6 shrink-0" />
        </ThreadPrimitive.If>
      </ThreadPrimitive.Viewport>
      <Composer />
    </ThreadPrimitive.Root>
  );
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        // aui-thread-scroll-to-bottom
        className="dark:bg-background dark:hover:bg-accent absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

/** The welcome for a new chat, or a skeleton while a conversation's history loads. */
const ThreadBody: FC = () => {
  const { loadingThread, booting } = useChat();
  const empty = useAuiState((s) => s.thread.messages.length === 0);
  if (!loadingThread) return <ThreadWelcome />;
  // At boot the skeleton is already on screen, so carry it on; a switch waits a beat first.
  return empty ? <ConversationSkeleton delayed={!booting} /> : null;
};

const ThreadWelcome: FC = () => {
  const { serviceInfo, agentId } = useChat();
  const currentAgent = serviceInfo.agents.find((agent) => agent.key === agentId);
  const welcomeMessage = currentAgent?.description || "How can I help you today?";

  return (
    <ThreadPrimitive.Empty>
      {/* aui-thread-welcome-root */}
      <div className="mx-auto flex w-full max-w-[var(--thread-max-width)] flex-grow flex-col px-[var(--thread-padding-x)]">
        {/* aui-thread-welcome-center */}
        <div className="flex w-full flex-grow flex-col items-center justify-center">
          {/* aui-thread-welcome-message */}
          <div className="flex size-full flex-col justify-center px-8 md:mt-20">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.25 }}
              // aui-thread-welcome-message-motion-1
              className="text-lg md:text-2xl font-semibold"
            >
              Welcome
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.25, delay: 0.05 }}
              // aui-thread-welcome-message-motion-2
              className="text-muted-foreground/65 text-lg md:text-2xl"
            >
              {welcomeMessage}
            </motion.div>
          </div>
        </div>
      </div>
    </ThreadPrimitive.Empty>
  );
};

const ThreadWelcomeSuggestions: FC = () => {
  const { agentId, loadingThread } = useChat();
  const suggestions =
    agentSuggestions[agentId as keyof typeof agentSuggestions] ?? agentSuggestions["auto-router"];
  if (loadingThread) return null;

  return (
    // aui-thread-welcome-suggestions
    <div className="grid w-full gap-2 sm:grid-cols-2">
      {suggestions.map((suggestedAction, index) => (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.25, delay: 0.1 + 0.04 * index }}
          key={`suggested-action-${suggestedAction.title}-${index}`}
          // aui-thread-welcome-suggestion-display
          className="[&:nth-child(n+4)]:hidden sm:[&:nth-child(n+4)]:block"
        >
          <ThreadPrimitive.Suggestion
            prompt={suggestedAction.action}
            method="replace"
            autoSend
            asChild
          >
            <Button
              variant="ghost"
              // aui-thread-welcome-suggestion
              className="dark:hover:bg-accent/60 h-auto w-full flex-1 flex-col items-start justify-start gap-[0.1rem] rounded-lg border px-3 py-2 text-left text-sm"
              aria-label={suggestedAction.action}
            >
              {/* aui-thread-welcome-suggestion-text-1 */}
              <span className="font-medium text-wrap">{suggestedAction.title}</span>
              {/* aui-thread-welcome-suggestion-text-2 */}
              <p className="text-muted-foreground text-wrap">{suggestedAction.label}</p>
            </Button>
          </ThreadPrimitive.Suggestion>
        </motion.div>
      ))}
    </div>
  );
};


const LimitBanner: FC = () => {
  const { limitMessage } = useChat();
  if (!limitMessage) return null;
  return (
    <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      <AlertCircle className="size-4 shrink-0" />
      <p>{limitMessage}</p>
    </div>
  );
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
      className={cn("text-sm", left === 0 ? "text-destructive" : "text-muted-foreground")}
      title={`${left} of ${tightest.limit} runs left this ${tightest.window}`}
    >
      {left}/{tightest.limit}
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
    <div className="bg-background relative mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col gap-4 px-[var(--thread-padding-x)] pb-[max(1rem,env(safe-area-inset-bottom))] md:pb-6">
      {/* Messages fade out into the composer rather than cutting off at its edge. */}
      <div className="from-background pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t to-transparent" />
      <ThreadScrollToBottom />
      <ThreadPrimitive.Empty>
        <ThreadWelcomeSuggestions />
      </ThreadPrimitive.Empty>
      <InterruptBanner />
      <LimitBanner />
      <ComposerPrimitive.Root className="focus-within::ring-offset-2 relative flex w-full flex-col rounded-2xl focus-within:ring-2 focus-within:ring-black dark:focus-within:ring-white">
        <ComposerPrimitive.Input
          placeholder="Send a message..."
          className={cn(
            "bg-muted border-border dark:border-muted-foreground/15 focus:outline-primary placeholder:text-muted-foreground max-h-[calc(50dvh)] min-h-16 w-full resize-none rounded-t-2xl border-x border-t px-4 pt-2 pb-3 text-base outline-none",
            isOverLimit && "border-destructive focus:ring-destructive",
          )}
          rows={1}
          autoFocus={!isTouch()}
          aria-label="Message input"
          submitMode={isSendDisabled ? "none" : "enter"}
        />
        <div className="bg-muted/80 border-1 dark:border-muted-foreground/15 relative flex flex-wrap items-center justify-between gap-y-1 rounded-b-2xl border-x border-b p-2">
          <div className="flex items-center gap-2">
            <AgentSelect />
            <ModelSelect />
          </div>
          <div className="flex items-center gap-2 pl-1">
            {text.length > 0 && (
              <span
                className={cn(
                  "font-mono text-xs",
                  isOverLimit ? "text-destructive" : remaining <= 50 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
                )}
                title={`${text.length}/${MAX_CHARACTERS} characters`}
              >
                {isOverLimit ? `+${-remaining}` : remaining}
              </span>
            )}
            <UsageCounter />
            <ThreadPrimitive.If running={false}>
              <ComposerPrimitive.Send asChild>
                <Button
                  type="submit"
                  variant="ghost"
                  className={cn(
                    "h-6.5 px-2 sm:px-3 inline-flex items-center gap-1 rounded-md border border-muted-foreground/20 bg-background/40 dark:bg-background/30",
                    isSendDisabled && "cursor-not-allowed opacity-50",
                  )}
                  aria-label="Send message"
                  disabled={isSendDisabled}
                >
                  <SendHorizontalIcon className="size-4" />
                </Button>
              </ComposerPrimitive.Send>
            </ThreadPrimitive.If>
            <ThreadPrimitive.If running>
              <ComposerPrimitive.Cancel asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-6.5 px-2 sm:px-3 inline-flex items-center gap-1 rounded-md border border-muted-foreground/20 bg-background/40 dark:bg-background/30"
                  aria-label="Stop generating"
                >
                  <Square className="size-3.5 fill-white dark:size-4 dark:fill-black" />
                </Button>
              </ComposerPrimitive.Cancel>
            </ThreadPrimitive.If>
          </div>
        </div>
      </ComposerPrimitive.Root>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      {/* aui-message-error-root */}
      <ErrorPrimitive.Root className="border-destructive bg-destructive/10 dark:bg-destructive/5 text-destructive mt-2 rounded-md border p-3 text-sm dark:text-red-200">
        {/* aui-message-error-message */}
        <ErrorPrimitive.Message className="line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

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
        className="relative mx-auto mb-4 grid w-full max-w-[var(--thread-max-width)] grid-cols-[auto_auto_1fr] grid-rows-[auto_1fr] px-[var(--thread-padding-x)] py-4"
        initial={{ y: 5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        data-role="assistant"
      >
        <div className="ring-border bg-background col-start-1 row-start-1 flex size-8 shrink-0 items-center justify-center rounded-full ring-1">
          <StarIcon size={14} />
        </div>
        <div className="text-foreground col-span-2 col-start-2 row-start-1 ml-4 leading-5 break-words">
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
      className="text-muted-foreground data-floating:bg-background col-start-3 row-start-2 mt-2 ml-3 flex gap-1 data-floating:absolute data-floating:mt-1 data-floating:rounded-md data-floating:border data-floating:p-1 data-floating:shadow-sm"
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
    // aui-user-action-bar-root: always shown, small until the message is hovered or focused
    className={cn(
      "text-muted-foreground col-start-2 row-start-2 mt-0.5 flex origin-top-right justify-end gap-1",
      "scale-75 opacity-60 transition-[scale,opacity] duration-200 ease-out motion-reduce:transition-none",
      "group-hover/user:scale-100 group-hover/user:opacity-100 focus-within:scale-100 focus-within:opacity-100",
    )}
  >
    <CopyAction />
    <UndoAction />
  </ActionBarPrimitive.Root>
);

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root asChild>
      <motion.div
        // aui-user-message-root
        className="group/user mx-auto grid w-full max-w-[var(--thread-max-width)] auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] gap-y-1 px-[var(--thread-padding-x)] py-4 [&:where(>*)]:col-start-2"
        initial={{ y: 5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        data-role="user"
      >
        {/* aui-user-message-content */}
        <div className="bg-muted text-foreground col-start-2 rounded-3xl px-5 py-2.5 break-words">
          <MessagePrimitive.Content components={{ Text: MarkdownText }} />
        </div>
        <UserActionBar />
      </motion.div>
    </MessagePrimitive.Root>
  );
};

const StarIcon = ({ size = 14 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M8 0L9.79611 6.20389L16 8L9.79611 9.79611L8 16L6.20389 9.79611L0 8L6.20389 6.20389L8 0Z"
      fill="currentColor"
    />
  </svg>
);
