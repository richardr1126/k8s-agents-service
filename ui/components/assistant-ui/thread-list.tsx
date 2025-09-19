import type { FC } from "react";
import {
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useThreadListItem,
} from "@assistant-ui/react";
import { Trash2Icon, PlusIcon, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { useThreadContext } from "@/components/custom-runtime-provider";
import { useUser } from "@/components/auth-user-provider";

export const ThreadList: FC = () => {
  return (
    <ThreadListPrimitive.Root className="flex flex-col items-stretch gap-1.5">
      <ThreadListNew />
      <ThreadListItems />
    </ThreadListPrimitive.Root>
  );
};

const ThreadListNew: FC = () => {
  return (
    <ThreadListPrimitive.New asChild>
      <Button className="data-active:bg-muted hover:bg-muted flex items-center justify-start gap-1 sm:mx-2 rounded-lg px-2.5 py-2 text-start" variant="ghost">
        <PlusIcon />
        New Thread
      </Button>
    </ThreadListPrimitive.New>
  );
};

const ThreadListItems: FC = () => {
  const { isLoading } = useUser();
  
  if (isLoading) {
    return <ThreadListLoading />;
  }
  
  return <ThreadListPrimitive.Items components={{ ThreadListItem }} />;
};

const ThreadListLoading: FC = () => {
  return (
    <div className="flex flex-col items-stretch gap-1.5">
      {/* Show 3 skeleton items while loading */}
      {[...Array(4)].map((_, index) => (
        <div 
          key={index}
          className="flex items-center gap-2 rounded-lg transition-all animate-pulse"
        >
          <div className="flex-grow px-3 py-2 text-start">
            <div className="flex items-center gap-2">
              <div className="h-4 bg-muted rounded w-3/4"></div>
            </div>
          </div>
          <div className="p-4 mr-1 size-4 flex items-center justify-center">
            <div className="h-3 w-3 bg-muted rounded"></div>
          </div>
        </div>
      ))}
    </div>
  );
};

const ThreadListItem: FC = () => {
  return (
    <ThreadListItemPrimitive.Root className="data-active:bg-muted hover:bg-muted focus-visible:bg-muted focus-visible:ring-ring flex items-center gap-2 sm:mx-2 rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2">
      <ThreadListItemPrimitive.Trigger className="flex-grow px-3 py-2 text-start">
        <div className="flex items-center gap-2">
          <ThreadListItemTitle />
          <ThreadListItemLoading />
        </div>
      </ThreadListItemPrimitive.Trigger>
      <ThreadListItemDelete />
    </ThreadListItemPrimitive.Root>
  );
};

const ThreadListItemTitle: FC = () => {
  return (
    <p className="text-sm">
      <ThreadListItemPrimitive.Title fallback="New Chat" />
    </p>
  );
};

const ThreadListItemLoading: FC = () => {
  const { runningThreads } = useThreadContext();
  const threadListItem = useThreadListItem();
  
  if (!threadListItem || !runningThreads.has(threadListItem.threadId)) {
    return null;
  }
  
  return (
    <div className="flex items-center">
      <Loader2 className="h-3 w-3 animate-spin" />
    </div>
  );
};

const ThreadListItemDelete: FC = () => {
  const { deleteThread } = useUser();
  const threadListItem = useThreadListItem();
  
  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!threadListItem) return;
    
    // Confirm deletion
    if (confirm('Are you sure you want to delete this thread? This action cannot be undone.')) {
      // Delete from UI state (handled by useUser)
      await deleteThread(threadListItem.threadId);
      
      // Call backend to delete thread data
      try {
        await fetch('/api/thread/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ threadId: threadListItem.threadId }),
        });
      } catch (error) {
        console.error('Error deleting thread from backend:', error);
      }
    }
  };
  
  return (
    <TooltipIconButton
      className="hover:text-destructive p-4 text-foreground/60 ml-auto mr-1 size-4"
      variant="ghost"
      tooltip="Delete thread"
      onClick={handleDelete}
    >
      <Trash2Icon />
    </TooltipIconButton>
  );
};
