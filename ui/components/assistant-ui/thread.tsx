import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ErrorPrimitive,
  useMessage,
} from "@assistant-ui/react";
import type { FC } from "react";
import { useEffect, useState } from "react";
import {
  ArrowDownIcon,
  CopyIcon,
  CheckIcon,
  PencilIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Square,
  SendHorizontalIcon,
} from "lucide-react";
import { useServiceInfo } from "@/components/service-info-provider";

import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { MarkdownText } from "./markdown-text";
import { ToolFallback } from "./tool-fallback";
import { useThreadContext } from "@/components/custom-runtime-provider";
import { AgentSelect } from "@/components/agent-select";
import { ModelSelect } from "@/components/model-select";
import { useUser } from "@/components/auth-user-provider";
import agentSuggestions from "./agent-suggestions.json";

export const Thread: FC = () => {
  const { isLoading: userLoading } = useUser();
  const { isLoading: serviceLoading } = useServiceInfo();
  
  // Base loading depends only on user/service loading to avoid transient data races
  const baseLoading = userLoading || serviceLoading;

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
    <ThreadPrimitive.Root
      // aui-thread-root
      className="bg-background flex h-full flex-col pb-2 sm:pb-0"
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
  return (
    // aui-composer-wrapper
    <div className="bg-background relative mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col gap-4 px-[var(--thread-padding-x)] pb-4 md:pb-6">
      <ThreadScrollToBottom />
      <ThreadPrimitive.Empty>
        <ThreadWelcomeSuggestions />
      </ThreadPrimitive.Empty>
      {/* aui-composer-root */}
      <ComposerPrimitive.Root className="focus-within::ring-offset-2 relative flex w-full flex-col rounded-2xl focus-within:ring-2 focus-within:ring-black dark:focus-within:ring-white">
        {/* aui-composer-input */}
        <ComposerPrimitive.Input
          placeholder="Send a message..."
          className={
            "bg-muted border-border dark:border-muted-foreground/15 focus:outline-primary placeholder:text-muted-foreground max-h-[calc(50dvh)] min-h-16 w-full resize-none rounded-t-2xl border-x border-t px-4 pt-2 pb-3 text-base outline-none"
          }
          rows={1}
          autoFocus
          aria-label="Message input"
        />
        <ComposerAction />
      </ComposerPrimitive.Root>
    </div>
  );
};

const ComposerAction: FC = () => {
  const {
    selectedAgentId,
    setSelectedAgentId,
    selectedModelId,
    setSelectedModelId,
  } = useThreadContext();

  return (
    // aui-composer-action-wrapper
    <div className="bg-muted/80 border-top border-1 dark:border-muted-foreground/15 relative flex items-center justify-between rounded-b-2xl border-x border-b p-2">
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

      <ThreadPrimitive.If running={false}>
        <ComposerPrimitive.Send asChild>
          <Button
            type="submit"
            variant="ghost"
            // aui-composer-send
            className="h-6.5 px-2 sm:px-3 inline-flex items-center gap-1 rounded-md border border-muted-foreground/20 bg-background/40 dark:bg-background/30"
            aria-label="Send message"
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
  const message = useMessage();
  
  // Check if message has text content (to add margin below tools)
  const hasTextContent = message.content.some(part => 
    part.type === 'text' && part.text.trim().length > 0
  );

  return (
    <div className={cn(hasTextContent && "mb-6")}>
      <ToolFallback {...props} />
    </div>
  );
};

const AssistantMessage: FC = () => {
  const message = useMessage();
  
  // Check if message has text content to add margin to the message
  const hasTextContent = message.content.some(part => 
    part.type === 'text' && part.text.trim().length > 0
  );

  return (
    <MessagePrimitive.Root asChild>
      <motion.div
        // aui-assistant-message-root
        className={cn(
          "relative mx-auto grid w-full max-w-[var(--thread-max-width)] grid-cols-[auto_auto_1fr] grid-rows-[auto_1fr] px-[var(--thread-padding-x)] py-4",
          hasTextContent && "mb-4"
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
              tools: { Fallback: ToolFallbackWrapper },
            }}
          />
          <MessageError />
        </div>

        <AssistantActionBar />

        {/* aui-assistant-branch-picker */}
        <BranchPicker className="col-start-2 row-start-2 mr-2 -ml-2" />
      </motion.div>
    </MessagePrimitive.Root>
  );
};

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
