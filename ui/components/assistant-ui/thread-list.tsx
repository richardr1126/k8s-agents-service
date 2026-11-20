import { createContext, useContext, useMemo, useState, type FC } from "react";
import {
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import { Loader2, MessageSquareDashedIcon, PencilIcon, SearchIcon, SquarePenIcon, Trash2Icon, XIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useChat } from "@/components/custom-runtime-provider";
import { useDialogs } from "@/components/dialogs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Kbd } from "@/components/ui/kbd";
import { useSidebar } from "@/components/ui/sidebar";
import { ThreadListLoading } from "@/components/assistant-ui/loading-skeletons";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { historyQuery } from "@/lib/queries";
import type { ThreadRow } from "@/lib/types";
import { useIsMac } from "@/lib/use-platform";

/** The search text, lowercased; empty shows every conversation. */
const FilterContext = createContext("");

export const ThreadList: FC = () => {
  const { isMobile, setOpenMobile } = useSidebar();
  const [query, setQuery] = useState("");
  return (
    <ThreadListPrimitive.Root
      className="flex flex-col items-stretch"
      // On a phone the sidebar covers the chat; close it once a conversation is picked.
      onClick={(e) => {
        if (isMobile && (e.target as Element).closest("[data-opens-thread]")) setOpenMobile(false);
      }}
    >
      <div className="bg-sidebar sticky top-0 z-10 flex flex-col gap-1 px-1 pt-1 pb-2">
        <ThreadListNew />
        <ThreadListSearch value={query} onChange={setQuery} />
      </div>
      <FilterContext.Provider value={query.trim().toLowerCase()}>
        <ThreadListItems />
      </FilterContext.Provider>
    </ThreadListPrimitive.Root>
  );
};

const ThreadListNew: FC = () => {
  const mac = useIsMac();
  return (
    <ThreadListPrimitive.New asChild>
      <Button
        data-opens-thread
        variant="outline"
        className="bg-background dark:bg-card h-9 justify-start gap-2 px-2.5 text-[15px] font-medium shadow-xs md:h-8 md:text-sm"
      >
        <SquarePenIcon className="size-4" />
        New chat
        <span className="ml-auto hidden items-center gap-0.5 md:flex" aria-hidden>
          <Kbd>{mac ? "⌘" : "Ctrl"}</Kbd>
          <Kbd>⇧</Kbd>
          <Kbd>O</Kbd>
        </span>
      </Button>
    </ThreadListPrimitive.New>
  );
};

const ThreadListSearch: FC<{ value: string; onChange: (value: string) => void }> = ({ value, onChange }) => (
  <label className="text-muted-foreground focus-within:text-foreground relative flex items-center">
    <SearchIcon className="pointer-events-none absolute left-2.5 size-3.5" />
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === "Escape" && onChange("")}
      placeholder="Search chats"
      aria-label="Search conversations"
      className="placeholder:text-muted-foreground text-foreground focus-visible:border-ring focus-visible:ring-ring/25 h-9 w-full rounded-md border border-transparent bg-transparent pr-7 pl-8 text-base outline-none hover:bg-sidebar-accent/60 focus-visible:bg-background focus-visible:ring-[3px] md:h-8 md:text-sm [&::-webkit-search-cancel-button]:hidden"
    />
    {value && (
      <button
        type="button"
        onClick={() => onChange("")}
        aria-label="Clear search"
        className="hover:text-foreground absolute right-1.5 rounded p-0.5"
      >
        <XIcon className="size-3.5" />
      </button>
    )}
  </label>
);

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
  const filter = useContext(FilterContext);
  const matches = useMemo(
    () => (threads ?? []).filter((t) => !filter || (t.title ?? "new chat").toLowerCase().includes(filter)),
    [threads, filter],
  );
  const shown = useMemo(() => new Set(matches.map((t) => t.id)), [matches]);
  const headers = useMemo(() => groupHeaders(matches), [matches]);

  if (isLoading) return <ThreadListLoading />;
  if (count === 0) {
    return <EmptyState icon={MessageSquareDashedIcon} title="No conversations yet" description="Your chats will show up here." />;
  }
  if (filter && matches.length === 0) {
    return <EmptyState icon={SearchIcon} title="No matches" description="Try a different word." />;
  }

  return (
    <div className="flex flex-col gap-px px-1 pb-2">
      <ThreadListPrimitive.Items>
        {({ threadListItem }) =>
          !filter || shown.has(threadListItem.id) ? (
            <>
              {headers.has(threadListItem.id) && (
                <p className="text-muted-foreground px-2.5 pt-4 pb-1 text-xs font-medium first:pt-1">
                  {headers.get(threadListItem.id)}
                </p>
              )}
              <ThreadListItem />
            </>
          ) : null
        }
      </ThreadListPrimitive.Items>
    </div>
  );
};

const ThreadListItem: FC = () => {
  const queryClient = useQueryClient();
  const id = useAuiState((s) => s.threadListItem.id);
  // Fetch on hover or focus, so the click opens it from cache.
  const prefetch = () => void queryClient.prefetchQuery(historyQuery(id));
  return (
    <ThreadListItemPrimitive.Root
      onPointerEnter={prefetch}
      onFocus={prefetch}
      className="group/item data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground hover:bg-sidebar-accent/70 focus-within:bg-sidebar-accent/70 relative flex h-9 items-center rounded-md transition-colors md:h-8"
    >
      <ThreadListItemPrimitive.Trigger
        data-opens-thread
        className="focus-visible:ring-ring pointer-fine:group-focus-within/item:pr-16 pointer-fine:group-hover/item:pr-16 flex h-full min-w-0 flex-grow items-center gap-2 rounded-md pr-1 pl-2.5 text-start outline-none focus-visible:ring-2 pointer-fine:pr-2.5"
      >
        <ThreadListItemTitle />
        <ThreadListItemLoading />
      </ThreadListItemPrimitive.Trigger>
      {/* Touch screens can't hover, so the buttons sit beside the title; with a mouse they appear over it on hover, and the title makes room. */}
      <div className="pointer-fine:bg-sidebar-accent pointer-fine:absolute pointer-fine:right-0.5 pointer-fine:opacity-0 pointer-fine:group-focus-within/item:opacity-100 pointer-fine:group-hover/item:opacity-100 flex shrink-0 items-center rounded-md pr-0.5 transition-opacity pointer-fine:pr-0">
        <ThreadListItemRename />
        <ThreadListItemDelete />
      </div>
    </ThreadListItemPrimitive.Root>
  );
};

const ThreadListItemTitle: FC = () => {
  return (
    <p className="truncate text-[15px] md:text-[13px]">
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
    <TooltipIconButton className="text-muted-foreground hover:text-foreground size-7 p-0" variant="ghost" tooltip="Rename" onClick={onClick}>
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
    <TooltipIconButton className="hover:text-destructive text-muted-foreground size-7 p-0" variant="ghost" tooltip="Delete" onClick={onClick}>
      <Trash2Icon className="size-3.5" />
    </TooltipIconButton>
  );
};
