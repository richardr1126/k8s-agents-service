import type { FC } from "react";
import {
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useThreadListItem,
} from "@assistant-ui/react";
import { Trash2Icon, CirclePlusIcon, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
      <Button className="data-active:bg-muted hover:bg-muted flex items-center justify-start gap-2 mx-2 rounded-lg px-2.5 py-2 text-start text-md md:text-sm" variant="ghost">
        <CirclePlusIcon />
        Start new chat
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
      {/* Show skeleton items while loading */}
      {[0, 1, 2, 3, 4].map((index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 * index }}
          className="flex items-center gap-2 mx-2 rounded-lg min-h-[44px] py-1"
        >
          <div className="flex-grow px-1 py-1">
            <Skeleton 
              className="h-6" 
              style={{ width: `${60 + Math.random() * 40}%` }}
            />
          </div>
        </motion.div>
      ))}
    </div>
  );
};

const ThreadListItem: FC = () => {
  return (
    <ThreadListItemPrimitive.Root className="data-active:bg-muted hover:bg-muted focus-visible:bg-muted focus-visible:ring-ring flex items-center gap-2 mx-2 rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2">
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
    <p className="text-md md:text-sm md:leading-tight">
      <ThreadListItemPrimitive.Title fallback="New Chat" />
    </p>
  );
};

const ThreadListItemLoading: FC = () => {
  const { runningThreads } = useThreadContext();
  const threadListItem = useThreadListItem();
  
  if (!threadListItem || !runningThreads.has(threadListItem.id)) {
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
      // Delete thread (this handles both frontend DB and backend deletion)
      await deleteThread(threadListItem.id);
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
