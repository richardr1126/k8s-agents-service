import { useMemo, type FC } from "react";
import {
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import { CirclePlusIcon, Loader2, MessageSquareDashedIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { useChat } from "@/components/custom-runtime-provider";
import { useDialogs } from "@/components/dialogs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import type { ThreadRow } from "@/lib/types";

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

const DAY = 24 * 60 * 60 * 1000;

function groupLabel(updatedAt: string, now: Date): string {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = Date.parse(updatedAt);
  if (time >= startOfToday) return "Today";
  if (time >= startOfToday - DAY) return "Yesterday";
  if (time >= startOfToday - 6 * DAY) return "Previous 7 days";
  if (time >= startOfToday - 29 * DAY) return "Previous 30 days";
  return "Older";
}

/** The group label to show above each thread that starts a new date group. */
function groupHeaders(threads: ThreadRow[]): Map<string, string> {
  const now = new Date();
  const headers = new Map<string, string>();
  let previous: string | null = null;
  for (const thread of threads) {
    const label = groupLabel(thread.updatedAt, now);
    if (label !== previous) headers.set(thread.id, label);
    previous = label;
  }
  return headers;
}

const ThreadListItems: FC = () => {
  const isLoading = useAuiState((s) => s.threads.isLoading);
  const count = useAuiState((s) => s.threads.threadIds.length);
  const { threads } = useChat();
  const headers = useMemo(() => groupHeaders(threads ?? []), [threads]);

  if (isLoading) return <ThreadListLoading />;
  if (count === 0) {
    return (
      <div className="text-muted-foreground mx-2 flex flex-col items-center gap-2 px-3 py-8 text-center text-sm">
        <MessageSquareDashedIcon className="size-5" />
        <p>No conversations yet</p>
      </div>
    );
  }

  return (
    <ThreadListPrimitive.Items>
      {({ threadListItem }) => (
        <>
          {headers.has(threadListItem.id) && (
            <p className="text-muted-foreground mx-2 mt-3 px-3 text-xs font-medium first:mt-0">
              {headers.get(threadListItem.id)}
            </p>
          )}
          <ThreadListItem />
        </>
      )}
    </ThreadListPrimitive.Items>
  );
};

const ThreadListLoading: FC = () => {
  return (
    <div className="flex flex-col items-stretch gap-1.5">
      {[78, 64, 90, 70, 84].map((width, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 * index }}
          className="flex items-center gap-2 mx-2 rounded-lg min-h-[44px] py-1"
        >
          <div className="flex-grow px-1 py-1">
            <Skeleton className="h-6" style={{ width: `${width}%` }} />
          </div>
        </motion.div>
      ))}
    </div>
  );
};

const ThreadListItem: FC = () => {
  return (
    <ThreadListItemPrimitive.Root className="group/item data-active:bg-muted hover:bg-muted focus-visible:bg-muted focus-visible:ring-ring flex items-center gap-1 mx-2 rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2">
      <ThreadListItemPrimitive.Trigger className="min-w-0 flex-grow px-3 py-2 text-start">
        <div className="flex items-center gap-2">
          <ThreadListItemTitle />
          <ThreadListItemLoading />
        </div>
      </ThreadListItemPrimitive.Trigger>
      <div className="mr-1 flex shrink-0 items-center opacity-100 transition-opacity md:opacity-0 md:group-hover/item:opacity-100 md:group-focus-within/item:opacity-100 md:group-data-active/item:opacity-100">
        <ThreadListItemRename />
        <ThreadListItemDelete />
      </div>
    </ThreadListItemPrimitive.Root>
  );
};

const ThreadListItemTitle: FC = () => {
  return (
    <p className="truncate text-md md:text-sm md:leading-tight">
      <ThreadListItemPrimitive.Title fallback="New Chat" />
    </p>
  );
};

/** Only the open thread can run: switching threads stops the run. */
const ThreadListItemLoading: FC = () => {
  const isRunning = useAuiState((s) => s.thread.isRunning && s.threads.mainThreadId === s.threadListItem.id);
  if (!isRunning) return null;
  return <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-label="Running" />;
};

const ThreadListItemRename: FC = () => {
  const aui = useAui();
  const { prompt } = useDialogs();
  const title = useAuiState((s) => s.threadListItem.title);

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = await prompt({
      title: "Rename conversation",
      defaultValue: title ?? "",
      placeholder: "Conversation name",
      confirmLabel: "Rename",
      maxLength: 200,
    });
    if (!next || next === title) return;
    try {
      await aui.threadListItem().rename(next);
      toast.success("Conversation renamed");
    } catch {
      toast.error("Could not rename the conversation.");
    }
  };

  return (
    <TooltipIconButton className="text-foreground/60 size-7 p-0" variant="ghost" tooltip="Rename" onClick={onClick}>
      <PencilIcon className="size-3.5" />
    </TooltipIconButton>
  );
};

const ThreadListItemDelete: FC = () => {
  const aui = useAui();
  const { confirm } = useDialogs();
  const title = useAuiState((s) => s.threadListItem.title);

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirm({
      title: "Delete conversation?",
      description: (
        <>
          <span className="text-foreground font-medium">{title || "This conversation"}</span> will be deleted.
          This can&apos;t be undone.
        </>
      ),
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await aui.threadListItem().delete();
      toast.success("Conversation deleted");
    } catch {
      toast.error("Could not delete the conversation.");
    }
  };

  return (
    <TooltipIconButton className="hover:text-destructive text-foreground/60 size-7 p-0" variant="ghost" tooltip="Delete" onClick={onClick}>
      <Trash2Icon className="size-3.5" />
    </TooltipIconButton>
  );
};
