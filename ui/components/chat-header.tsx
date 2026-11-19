"use client";

import { useAui, useAuiState } from "@assistant-ui/react";
import { SquarePenIcon } from "lucide-react";
import type { FC } from "react";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { useChat } from "@/components/custom-runtime-provider";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/** The bar above the conversation: the sidebar toggle, the conversation's title and a new chat button. */
export const ChatHeader: FC = () => {
  const aui = useAui();
  const { threads, loadingThread } = useChat();
  const { open, isMobile } = useSidebar();
  const mainId = useAuiState((s) => s.threads.mainThreadId);
  const empty = useAuiState((s) => s.thread.messages.length === 0);
  const title = threads?.find((t) => t.id === mainId)?.title;
  // The sidebar has its own new chat button; repeat it here when the sidebar is out of sight.
  const showNew = isMobile || !open;

  return (
    <header className="bg-background z-20 flex h-[calc(3rem+env(safe-area-inset-top))] shrink-0 items-center gap-1 px-2 pt-[env(safe-area-inset-top)] pl-[max(0.5rem,env(safe-area-inset-left))] md:px-3">
      <SidebarTrigger className="text-muted-foreground hover:text-foreground size-8" />
      <h1
        className={cn(
          "min-w-0 flex-1 truncate px-1 text-sm font-medium transition-opacity",
          (empty || loadingThread) && !title && "opacity-0",
        )}
      >
        {title || (empty ? "" : "New chat")}
      </h1>
      {showNew && (
        <TooltipIconButton
          tooltip="New chat"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground size-8"
          onClick={() => void aui.threads().switchToNewThread()}
        >
          <SquarePenIcon className="size-4" />
        </TooltipIconButton>
      )}
    </header>
  );
};
