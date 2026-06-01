import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ErrorPrimitive,
  AssistantRuntimeProvider,
  ExternalStoreAdapter,
  useExternalStoreRuntime,
  useMessage,
  useComposer,
} from "@assistant-ui/react";
import type { FC, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownIcon,
  CalculatorIcon,
  ChevronDownIcon,
  CloudIcon,
  CopyIcon,
  CheckIcon,
  PencilIcon,
  SearchIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XIcon,
  Square,
  SendHorizontalIcon,
  WrenchIcon,
} from "lucide-react";
import { useServiceInfo } from "@/components/service-info-provider";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { MarkdownText } from "./markdown-text";
import { ToolFallback } from "./tool-fallback";
import { ReasoningPart } from "./reasoning";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TaskToolUI } from "@/components/task-ui";
import {
  convertMessage,
  ROOT_BRANCH_ID,
  useThreadContext,
} from "@/components/custom-runtime-provider";
import { ChatMessage } from "@/lib/types";
import { AgentSelect } from "@/components/agent-select";
import { ModelSelect } from "@/components/model-select";
import { useUser } from "@/components/auth-user-provider";
import { RateLimitDisplay, RateLimitBanner } from "@/components/rate-limit-display";
import { useRateLimit } from "@/components/rate-limit-provider";
import { useSession } from "@/lib/auth-client";
import { hasUnlimitedUsageOverride, isUnlimitedRateLimit } from "@/lib/usage-overrides";
import agentSuggestions from "./agent-suggestions.json";

export const Thread: FC = () => {
  const { isLoading: userLoading } = useUser();
  const { currentThreadId, threads, isSubAgentPanelOpen } = useThreadContext();
  
  // Show thread skeleton when:
  // 1. User is still loading (authentication)
  // 2. We have a thread ID but no messages loaded for it yet (thread data loading)
  const isThreadDataLoading = currentThreadId && !threads.has(currentThreadId);
  const baseLoading = userLoading || isThreadDataLoading;

  // Debounce the transition from loading -> not loading to smooth out quick flips
  const [isThreadLoading, setIsThreadLoading] = useState(baseLoading);
  useEffect(() => {
    if (baseLoading) {
      setIsThreadLoading(true);
      return;
    }
    const t = setTimeout(() => setIsThreadLoading(false), 150);
    return () => clearTimeout(t);
  }, [baseLoading]);

  if (isThreadLoading) {
    return <ThreadLoadingSkeleton />;
  }

  return (
    <div className="bg-background flex h-full min-w-0">
      <ThreadPrimitive.Root
        // aui-thread-root
        className={cn(
          "bg-background flex h-full min-w-0 flex-col pb-2 sm:pb-0",
          isSubAgentPanelOpen ? "flex-1" : "w-full",
        )}
        style={{
          ["--thread-max-width" as string]: "48rem",
          ["--thread-padding-x" as string]: "0.7rem",
        }}
      >
        {/* aui-thread-viewport */}
        <ThreadPrimitive.Viewport className="relative flex min-w-0 flex-1 flex-col gap-0 overflow-y-scroll pt-8">
          <ThreadWelcome />

          <ThreadPrimitive.Messages
            components={{
              UserMessage,
              EditComposer,
              AssistantMessage,
            }}
          />

          <ThreadPrimitive.If empty={false}>
            {/* aui-thread-viewport-spacer */}
            <motion.div className="min-h-6 min-w-6 shrink-0" />
          </ThreadPrimitive.If>
        </ThreadPrimitive.Viewport>

        <Composer />
      </ThreadPrimitive.Root>

      <SubAgentSidePanel />
    </div>
  );
};

const ThreadLoadingSkeleton: FC = () => {
  return (
    <div className="bg-background flex h-full flex-col">
      {/* Skeleton for main content area */}
      <div className="relative flex min-w-0 flex-1 flex-col gap-0 overflow-y-scroll pt-8">
        <div className="mx-auto flex w-full max-w-[48rem] flex-grow flex-col px-2">
          {/* Welcome section skeleton */}
          <div className="flex w-full flex-grow flex-col items-center justify-center">
            <div className="flex size-full flex-col justify-center px-8 md:mt-20">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="mb-4"
              >
                <Skeleton className="h-8 w-32 md:h-10 md:w-40" />
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="mb-8"
              >
                <Skeleton className="h-6 w-64 md:h-8 md:w-80" />
              </motion.div>
            </div>
          </div>
          
          {/* Suggestions skeleton */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="grid w-full gap-2 sm:grid-cols-2 mb-4"
          >
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className={`h-auto w-full ${i === 4 ? 'hidden sm:block' : ''}`}>
              <Skeleton className="h-9 sm:14 w-full rounded-lg" />
              </div>
            ))}
          </motion.div>
        </div>
      </div>

      {/* Composer skeleton */}
      <div className="bg-background relative mx-auto flex w-full max-w-[48rem] flex-col gap-4 px-2 pb-4 md:pb-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="relative flex w-full flex-col rounded-2xl"
        >
          {/* Input skeleton */}
          <Skeleton className="h-15 w-full rounded-t-2xl" />
          {/* Action bar skeleton */}
          <div className="bg-muted border-border dark:border-muted-foreground/15 relative flex items-center justify-between rounded-b-2xl border-x border-b p-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-24" />
            </div>
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
        </motion.div>
      </div>
    </div>
  );
};

const NOOP_ON_NEW = async () => {
  throw new Error("Sub-agent side panel is read-only");
};

const DEFAULT_SUBAGENT_PANEL_WIDTH = 42 * 16;
const MIN_SUBAGENT_PANEL_WIDTH = 24 * 16;
const MIN_MAIN_THREAD_WIDTH = 22 * 16;

const SubAgentSidePanel: FC = () => {
  const {
    currentThreadId,
    threads,
    runningThreads,
    isSubAgentPanelOpen,
    setSubAgentPanelOpen,
    selectedSubAgentBranchId,
    setSelectedSubAgentBranchId,
    closeSubAgentPanel,
  } = useThreadContext();
  const isMobile = useIsMobile();
  const [desktopPanelWidth, setDesktopPanelWidth] = useState(DEFAULT_SUBAGENT_PANEL_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef<{ x: number; width: number } | null>(null);

  const allMessages = useMemo(
    () => (currentThreadId ? (threads.get(currentThreadId) ?? []) : []),
    [currentThreadId, threads],
  );

  const branchIds = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const message of allMessages) {
      const branchId = message.branchId;
      if (!branchId || branchId === ROOT_BRANCH_ID) continue;
      if (seen.has(branchId)) continue;
      seen.add(branchId);
      ordered.push(branchId);
    }
    return ordered;
  }, [allMessages]);

  const activeBranchId = useMemo(() => {
    // Preserve explicit selection even before first branch message arrives.
    if (selectedSubAgentBranchId) {
      return selectedSubAgentBranchId;
    }
    return branchIds[0] ?? null;
  }, [selectedSubAgentBranchId, branchIds]);

  const activeBranchLabel = useMemo(() => {
    if (!activeBranchId) return "Sub-agent Stream";
    const prefix = activeBranchId.split(":")[0] || activeBranchId;
    switch (prefix) {
      case "resume":
        return "Resume Agent";
      case "web":
        return "Web Research Agent";
      case "postgres":
        return "Postgres Agent";
      default:
        return "Sub-agent Stream";
    }
  }, [activeBranchId]);

  useEffect(() => {
    // Only auto-select when nothing is selected yet.
    if (selectedSubAgentBranchId || !activeBranchId) return;
    setSelectedSubAgentBranchId(activeBranchId);
  }, [activeBranchId, selectedSubAgentBranchId, setSelectedSubAgentBranchId]);

  const branchMessages = useMemo(
    () => (activeBranchId ? allMessages.filter((message) => message.branchId === activeBranchId) : []),
    [activeBranchId, allMessages],
  );

  const branchRuntimeAdapter = useMemo<ExternalStoreAdapter<ChatMessage>>(
    () => ({
      messages: branchMessages,
      isRunning: Boolean(currentThreadId && activeBranchId && runningThreads.has(currentThreadId)),
      onNew: NOOP_ON_NEW,
      convertMessage,
    }),
    [activeBranchId, branchMessages, currentThreadId, runningThreads],
  );
  const branchRuntime = useExternalStoreRuntime(branchRuntimeAdapter);

  const clampDesktopWidth = useCallback((width: number) => {
    if (typeof window === "undefined") {
      return Math.max(MIN_SUBAGENT_PANEL_WIDTH, width);
    }
    const maxWidth = Math.max(
      MIN_SUBAGENT_PANEL_WIDTH,
      window.innerWidth - MIN_MAIN_THREAD_WIDTH,
    );
    return Math.min(Math.max(width, MIN_SUBAGENT_PANEL_WIDTH), maxWidth);
  }, []);

  useEffect(() => {
    if (isSubAgentPanelOpen) return;
    setDesktopPanelWidth(DEFAULT_SUBAGENT_PANEL_WIDTH);
    setIsResizing(false);
    resizeStartRef.current = null;
  }, [isSubAgentPanelOpen]);

  useEffect(() => {
    if (!isSubAgentPanelOpen || isMobile) return;
    const onWindowResize = () => {
      setDesktopPanelWidth((width) => clampDesktopWidth(width));
    };
    window.addEventListener("resize", onWindowResize);
    onWindowResize();
    return () => window.removeEventListener("resize", onWindowResize);
  }, [clampDesktopWidth, isMobile, isSubAgentPanelOpen]);

  useEffect(() => {
    if (!isResizing) return;
    const onPointerMove = (event: PointerEvent) => {
      const resizeStart = resizeStartRef.current;
      if (!resizeStart) return;
      const dragDelta = resizeStart.x - event.clientX;
      const nextWidth = resizeStart.width + dragDelta;
      setDesktopPanelWidth(clampDesktopWidth(nextWidth));
    };
    const stopResizing = () => {
      setIsResizing(false);
      resizeStartRef.current = null;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [clampDesktopWidth, isResizing]);

  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStartRef.current = {
      x: event.clientX,
      width: clampDesktopWidth(desktopPanelWidth),
    };
    setIsResizing(true);
  };

  const panelContent = (
    <>
      <div className="border-b border-border/60 px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">{activeBranchLabel}</div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={closeSubAgentPanel}
            aria-label="Close sub-agent panel"
          >
            <XIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <AssistantRuntimeProvider runtime={branchRuntime}>
        <TaskToolUI />
        <ThreadPrimitive.Root
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          style={{
            ["--thread-max-width" as string]: "100%",
            ["--thread-padding-x" as string]: "0.8rem",
          }}
        >
          <ThreadPrimitive.Viewport className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-y-scroll pt-4">
            <ThreadPrimitive.Empty>
              <div className="text-muted-foreground px-4 py-6 text-sm">
                Waiting for branch events...
              </div>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages
              components={{
                UserMessage: UserSidebarMessage,
                EditComposer,
                AssistantMessage: AssistantSidebarMessage,
              }}
            />
            <ThreadPrimitive.If empty={false}>
              <motion.div className="min-h-5 min-w-5 shrink-0" />
            </ThreadPrimitive.If>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={isSubAgentPanelOpen} onOpenChange={setSubAgentPanelOpen}>
        <SheetContent
          side="right"
          className="bg-background border-l border-border/70 flex h-full w-[85vw] max-w-[42rem] min-w-0 flex-col gap-0 p-0 [&>button]:hidden"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Sub-agent panel</SheetTitle>
            <SheetDescription>
              Displays the active sub-agent stream and branch events.
            </SheetDescription>
          </SheetHeader>
          {panelContent}
        </SheetContent>
      </Sheet>
    );
  }

  if (!isSubAgentPanelOpen) {
    return null;
  }

  return (
    <aside
      className="bg-background border-l border-border/70 relative flex h-full min-w-0 shrink-0 flex-col overflow-hidden"
      style={{ width: `${desktopPanelWidth}px` }}
    >
      <div
        className="absolute top-0 left-0 z-20 h-full w-2 -translate-x-1/2 cursor-col-resize touch-none"
        onPointerDown={onResizePointerDown}
        aria-hidden="true"
      />
      <div
        className={cn(
          "bg-border/60 absolute inset-y-0 left-0 w-px",
          isResizing && "bg-primary/80",
        )}
        aria-hidden="true"
      />
      {panelContent}
    </aside>
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

const ThreadWelcome: FC = () => {
  const { selectedAgentId } = useThreadContext();
  const { serviceInfo } = useServiceInfo();
  
  // Find the current agent's description
  const currentAgent = serviceInfo?.agents?.find(
    agent => agent.key === (selectedAgentId || serviceInfo?.default_agent)
  );
  
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
              transition={{ delay: 0.5 }}
              // aui-thread-welcome-message-motion-1
              className="text-lg md:text-2xl font-semibold"
            >
              Welcome
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ delay: 0.6 }}
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
  const { selectedAgentId } = useThreadContext();
  const { serviceInfo } = useServiceInfo();
  
  // Get suggestions for the current agent, fallback to auto-router suggestions
  const currentAgentId = selectedAgentId || serviceInfo?.default_agent || "auto-router";
  const suggestions = agentSuggestions[currentAgentId as keyof typeof agentSuggestions] || agentSuggestions["auto-router"];

  return (
    // aui-thread-welcome-suggestions
    <div className="grid w-full gap-2 sm:grid-cols-2">
      {suggestions.map((suggestedAction, index) => (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ delay: 0.05 * index }}
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
              className="dark:hover:bg-accent/60 h-auto w-full flex-1 flex-wrap items-start justify-start gap-[0.1rem] rounded-lg border px-3 py-2 text-left text-sm sm:flex-col"
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

const Composer: FC = () => {
  // Use the useComposer hook to get the current text value from composer state
  const composerText = useComposer((state) => state.text);
  const { data: session } = useSession();
  const hasUnlimitedChars = hasUnlimitedUsageOverride({
    id: session?.user?.id,
    email: session?.user?.email,
  });
  const maxCharacters = hasUnlimitedChars ? null : 560; // 2 tweets worth (280 chars each)
  const isOverLimit = maxCharacters !== null && composerText.length > maxCharacters;
  const charactersRemaining = maxCharacters === null ? null : (maxCharacters - composerText.length);

  // Import the rate limit hook to check status
  const { status } = useRateLimit();
  const isAtLimit = status ? (!isUnlimitedRateLimit(status.limit) && status.remainingMessages <= 0) : false;
  const isSendDisabled = isAtLimit || isOverLimit || composerText.trim().length === 0;

  // Handle keyboard events to prevent submission when disabled
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isSendDisabled) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }
  };

  return (
    // aui-composer-wrapper
    <div className="bg-background relative mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col gap-4 px-[var(--thread-padding-x)] pb-4 md:pb-6">
      <ThreadScrollToBottom />
      <ThreadPrimitive.Empty>
        <ThreadWelcomeSuggestions />
      </ThreadPrimitive.Empty>
      
      {/* Rate Limit Banner */}
      <RateLimitBanner />
      
      {/* aui-composer-root */}
      <ComposerPrimitive.Root className="focus-within::ring-offset-2 relative flex w-full flex-col rounded-2xl focus-within:ring-2 focus-within:ring-black dark:focus-within:ring-white">
        {/* aui-composer-input */}
        <ComposerPrimitive.Input
          placeholder="Send a message..."
          className={cn(
            "bg-muted border-border dark:border-muted-foreground/15 focus:outline-primary placeholder:text-muted-foreground max-h-[calc(50dvh)] min-h-16 w-full resize-none rounded-t-2xl border-x border-t px-4 pt-2 pb-3 text-base outline-none",
            isOverLimit && "border-destructive focus:ring-destructive"
          )}
          rows={1}
          autoFocus
          aria-label="Message input"
          onKeyDown={handleKeyDown}
          maxLength={maxCharacters !== null ? maxCharacters + 50 : undefined} // Allow some buffer for user awareness
        />
        <ComposerAction 
          inputValue={composerText}
          maxCharacters={maxCharacters}
          isOverLimit={isOverLimit}
          charactersRemaining={charactersRemaining}
        />
      </ComposerPrimitive.Root>
    </div>
  );
};

interface ComposerActionProps {
  inputValue: string;
  maxCharacters: number | null;
  isOverLimit: boolean;
  charactersRemaining: number | null;
}

const ComposerAction: FC<ComposerActionProps> = ({ 
  inputValue, 
  maxCharacters,
  isOverLimit, 
  charactersRemaining 
}) => {
  const {
    selectedAgentId,
    setSelectedAgentId,
    selectedModelId,
    setSelectedModelId,
  } = useThreadContext();

  // Import the hook at the top of file and use it here
  const { status } = useRateLimit();
  const isAtLimit = status ? (!isUnlimitedRateLimit(status.limit) && status.remainingMessages <= 0) : false;
  const isSendDisabled = isAtLimit || isOverLimit || inputValue.trim().length === 0;
  const isUnlimitedChars = maxCharacters === null;

  return (
    // aui-composer-action-wrapper
    <div className="bg-muted/80 border-top border-1 dark:border-muted-foreground/15 relative flex items-center justify-between rounded-b-2xl border-x border-b p-2 flex-wrap gap-y-1">
      {/* left: model/agent selectors */}
      <div className="flex items-center gap-2">
        <AgentSelect
          className=""
          selectedAgentId={selectedAgentId}
          onAgentChange={setSelectedAgentId}
        />
        <ModelSelect
          className=""
          selectedModelId={selectedModelId}
          onModelChange={setSelectedModelId}
        />
      </div>
      {/* <TooltipIconButton
        tooltip="Attach file"
        variant="ghost"
        // aui-composer-attachment-button
        className="hover:bg-foreground/15 dark:hover:bg-background/50 scale-115 p-3.5"
        onClick={() => {
          console.log("Attachment clicked - not implemented");
        }}
      >
        <PlusIcon />
      </TooltipIconButton> */}

      {/* Rate limit display and action buttons */}
      <div className="flex items-center gap-2 pl-1">
        {/* Character count display */}
        {inputValue.length > 0 && (
          <span 
            className={cn(
              "text-xs font-mono",
              isOverLimit 
                ? "text-destructive" 
                : !isUnlimitedChars && (charactersRemaining ?? 0) <= 50
                  ? "text-amber-600 dark:text-amber-400" 
                  : "text-muted-foreground"
            )}
            title={
              isUnlimitedChars
                ? `${inputValue.length} characters used (unlimited)`
                : `${inputValue.length}/${maxCharacters} characters used`
            }
          >
            {isUnlimitedChars
              ? "∞"
              : (charactersRemaining ?? 0) < 0
                ? `+${Math.abs(charactersRemaining ?? 0)}`
                : (charactersRemaining ?? 0)}
          </span>
        )}
        
        <RateLimitDisplay compact={true} />
        
        <ThreadPrimitive.If running={false}>
          <ComposerPrimitive.Send asChild>
            <Button
              type="submit"
              variant="ghost"
              // aui-composer-send
              className={cn(
                "h-6.5 px-2 sm:px-3 inline-flex items-center gap-1 rounded-md border border-muted-foreground/20 bg-background/40 dark:bg-background/30",
                isSendDisabled && "opacity-50 cursor-not-allowed"
              )}
              aria-label={
                isOverLimit 
                  ? "Message too long" 
                  : isAtLimit 
                    ? "Rate limit reached" 
                    : "Send message"
              }
              disabled={isSendDisabled}
              title={
                isOverLimit 
                  ? `Message is ${Math.abs(charactersRemaining ?? 0)} characters over the limit`
                  : isAtLimit 
                    ? `Rate limit reached. ${status?.remainingMessages || 0} messages remaining today.`
                    : undefined
              }
            >
              {/* aui-composer-send-icon */}
              <SendHorizontalIcon className="size-4" />
            </Button>
          </ComposerPrimitive.Send>
        </ThreadPrimitive.If>

        <ThreadPrimitive.If running>
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              variant="ghost"
              // aui-composer-cancel
              className="h-6.5 px-2 sm:px-3 inline-flex items-center gap-1 rounded-md border border-muted-foreground/20 bg-background/40 dark:bg-background/30"
              aria-label="Stop generating"
            >
              {/* aui-composer-cancel-icon */}
              <Square className="size-3.5 fill-white dark:size-4 dark:fill-black" />
            </Button>
          </ComposerPrimitive.Cancel>
        </ThreadPrimitive.If>
      </div>
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

const ToolFallbackWrapper: FC<React.ComponentProps<typeof ToolFallback>> = (props) => {
  return (
    <div className="mb-3">
      <ToolFallback {...props} />
    </div>
  );
};

const getGroupToolIcon = (toolName: string) => {
  const name = toolName.toLowerCase();
  if (name.includes("search") || name.includes("web")) {
    return <SearchIcon className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400" />;
  }
  if (name.includes("calculator") || name.includes("math")) {
    return <CalculatorIcon className="h-3.5 w-3.5 text-green-500 dark:text-green-400" />;
  }
  if (name.includes("weather") || name.includes("climate")) {
    return <CloudIcon className="h-3.5 w-3.5 text-cyan-500 dark:text-cyan-400" />;
  }
  return <WrenchIcon className="h-3.5 w-3.5 text-orange-500 dark:text-orange-400" />;
};

const getGroupToolDisplayName = (toolName: string) =>
  toolName.replace(/[_-]/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

const ParallelToolGroup: FC<
  React.PropsWithChildren<{ startIndex: number; endIndex: number }>
> = ({ startIndex, endIndex, children }) => {
  const message = useMessage();

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
    <details className="mb-3 overflow-hidden rounded-lg border border-border/50 bg-muted/20">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-1.5 px-2.5 py-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {groupTools.map((tool) => (
            <span
              key={tool.key}
              className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-background/70 px-2 py-1 text-xs font-normal text-foreground leading-none"
            >
              {getGroupToolIcon(tool.name)}
              <span>{getGroupToolDisplayName(tool.name)}</span>
            </span>
          ))}
        </div>
        <div className="shrink-0 flex items-center">
          {isRunning ? (
            <Spinner className="text-muted-foreground" />
          ) : (
            <ChevronDownIcon className="h-4 w-4 text-muted-foreground transition-transform [&::-webkit-details-marker]:hidden [&_details[open]_&]:rotate-180" />
          )}
        </div>
      </summary>
      <div className="space-y-1.5 border-t border-border/40 p-2.5">
        {children}
      </div>
    </details>
  );
};

const AssistantMessageBase: FC<{ showBranchPicker: boolean }> = ({ showBranchPicker }) => {
  const message = useMessage();
  
  // Check if message has text content for action controls only.
  const hasTextContent = message.content.some(part => 
    part.type === 'text' && part.text.trim().length > 0
  );

  const hasToolContent = message.content.some(part => part.type === 'tool-call');
  const hasReasoningContent = message.content.some(part => part.type === 'reasoning');
  const hasBodyContent = hasTextContent || hasToolContent || hasReasoningContent;
  if (!hasBodyContent) {
    return null;
  }

  return (
    <MessagePrimitive.Root asChild>
      <motion.div
        // aui-assistant-message-root
        className={cn(
          "relative mx-auto grid w-full max-w-[var(--thread-max-width)] grid-cols-[auto_auto_1fr] grid-rows-[auto_1fr] px-[var(--thread-padding-x)] py-4",
          hasBodyContent && "mb-4"
        )}
        initial={{ y: 5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        data-role="assistant"
      >
        {/* aui-assistant-message-avatar */}
        <div className="ring-border bg-background col-start-1 row-start-1 flex size-8 shrink-0 items-center justify-center rounded-full ring-1">
          <StarIcon size={14} />
        </div>

        {/* aui-assistant-message-content */}
        <div className="text-foreground col-span-2 col-start-2 row-start-1 ml-4 leading-5 break-words">
          <MessagePrimitive.Content
            components={{
              Text: MarkdownText,
              Reasoning: ReasoningPart,
              tools: { Fallback: ToolFallbackWrapper },
              ToolGroup: ParallelToolGroup,
            }}
          />
          <MessageError />
        </div>

        <AssistantActionBar />

        {showBranchPicker ? (
          <BranchPicker className="col-start-2 row-start-2 mr-2 -ml-2" />
        ) : null}
      </motion.div>
    </MessagePrimitive.Root>
  );
};

const AssistantMessage: FC = () => <AssistantMessageBase showBranchPicker={true} />;

const AssistantSidebarMessage: FC = () => <AssistantMessageBase showBranchPicker={false} />;

const AssistantActionBar: FC = () => {
  const message = useMessage();
  
  // Check if message has any text content (not just tool calls)
  const hasTextContent = message.content.some(part => 
    part.type === 'text' && part.text.trim().length > 0
  );
  
  // Don't show action bar if message only contains tool calls
  if (!hasTextContent) {
    return null;
  }

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
      // aui-assistant-action-bar-root
      className="text-muted-foreground data-floating:bg-background col-start-3 row-start-2 mt-2 ml-3 flex gap-1 data-floating:absolute data-floating:mt-1 data-floating:rounded-md data-floating:border data-floating:p-1 data-floating:shadow-sm"
    >
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
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root asChild>
      <motion.div
        // aui-user-message-root
        className="mx-auto grid w-full max-w-[var(--thread-max-width)] auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] gap-y-1 px-[var(--thread-padding-x)] py-4 [&:where(>*)]:col-start-2"
        initial={{ y: 5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        data-role="user"
      >
        <UserActionBar />

        {/* aui-user-message-content */}
        <div className="bg-muted text-foreground col-start-2 rounded-3xl px-5 py-2.5 break-words">
          <MessagePrimitive.Content components={{ Text: MarkdownText }} />
        </div>

        {/* aui-user-branch-picker */}
        <BranchPicker className="col-span-full col-start-1 row-start-3 -mr-1 justify-end" />
      </motion.div>
    </MessagePrimitive.Root>
  );
};

const UserSidebarMessage: FC = () => {
  return (
    <MessagePrimitive.Root asChild>
      <motion.div
        className="mx-auto grid w-full max-w-[var(--thread-max-width)] auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] gap-y-1 px-[var(--thread-padding-x)] py-4 [&:where(>*)]:col-start-2"
        initial={{ y: 5, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        data-role="user"
      >
        <UserActionBar />
        <div className="bg-muted text-foreground col-start-2 rounded-3xl px-5 py-2.5 break-words">
          <MessagePrimitive.Content components={{ Text: MarkdownText }} />
        </div>
      </motion.div>
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      // aui-user-action-bar-root
      className="col-start-1 mt-2.5 mr-3 flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    // aui-edit-composer-wrapper
    <div className="mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col gap-4 px-[var(--thread-padding-x)]">
      {/* aui-edit-composer-root */}
      <ComposerPrimitive.Root className="bg-muted ml-auto flex w-full max-w-7/8 flex-col rounded-xl">
        {/* aui-edit-composer-input */}
        <ComposerPrimitive.Input
          className="text-foreground flex min-h-[60px] w-full resize-none bg-transparent p-4 outline-none"
          autoFocus
        />

        {/* aui-edit-composer-footer */}
        <div className="mx-3 mb-3 flex items-center justify-center gap-2 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm" aria-label="Cancel edit">
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm" aria-label="Update message">
              Update
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </div>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      // aui-branch-picker-root
      className={cn(
        "text-muted-foreground inline-flex items-center text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      {/* aui-branch-picker-state */}
      <span className="font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
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
