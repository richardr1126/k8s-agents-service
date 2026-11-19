"use client";

import type { FC } from "react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/*
 * Loading placeholders. They are static on purpose: a boot skeleton can mount
 * more than once as the session and service info arrive, and identical static
 * markup makes each remount invisible. Only ConversationSkeleton fades in, and
 * late, so a quick thread switch shows nothing at all.
 */

/** Rows shaped like the sidebar's conversation list. */
export const ThreadListLoading: FC = () => (
  <div className="flex flex-col items-stretch gap-1.5" aria-hidden>
    {[78, 64, 90, 70, 84].map((width) => (
      <div key={width} className="mx-2 flex min-h-[44px] items-center gap-2 rounded-lg py-1">
        <div className="flex-grow px-1 py-1">
          <Skeleton className="h-6" style={{ width: `${width}%` }} />
        </div>
      </div>
    ))}
  </div>
);

/** A user bubble and an assistant answer, twice: the shape of a conversation that is loading. */
export const ConversationSkeleton: FC<{ delayed?: boolean }> = ({ delayed = false }) => (
  <div
    role="status"
    aria-label="Loading conversation"
    className={cn(
      "mx-auto flex w-full max-w-[var(--thread-max-width,48rem)] flex-col px-[var(--thread-padding-x,0.7rem)]",
      delayed && "fade-in-late",
    )}
  >
    {[
      { user: "w-2/5", lines: ["w-full", "w-11/12", "w-3/4"] },
      { user: "w-1/3", lines: ["w-full", "w-5/6", "w-full", "w-2/3"] },
    ].map((turn, index) => (
      <div key={index}>
        <div className="flex justify-end py-4">
          <Skeleton className={cn("h-11 rounded-3xl", turn.user)} />
        </div>
        <div className="flex flex-col gap-2.5 px-2 py-4">
          {turn.lines.map((width, line) => (
            <Skeleton key={line} className={cn("h-4", width)} />
          ))}
        </div>
      </div>
    ))}
  </div>
);

const WelcomeSkeleton: FC = () => (
  <div className="mx-auto flex w-full max-w-[48rem] flex-grow flex-col px-[0.7rem]" aria-hidden>
    <div className="flex size-full flex-grow flex-col justify-center px-8 md:mt-20">
      <Skeleton className="mb-3 h-7 w-32 md:h-8 md:w-40" />
      <Skeleton className="h-7 w-64 md:h-8 md:w-96" />
    </div>
  </div>
);

const ComposerSkeleton: FC = () => (
  <div className="mx-auto flex w-full max-w-[48rem] flex-col px-[0.7rem] pb-[max(1rem,env(safe-area-inset-bottom))] md:pb-6" aria-hidden>
    <div className="bg-muted border-border dark:border-muted-foreground/15 min-h-16 rounded-t-2xl border-x border-t" />
    <div className="bg-muted/80 dark:border-muted-foreground/15 flex items-center justify-between rounded-b-2xl border-x border-b p-2">
      <div className="flex items-center gap-2">
        <Skeleton className="bg-background/60 h-6.5 w-24" />
        <Skeleton className="bg-background/60 h-6.5 w-28" />
      </div>
      <Skeleton className="bg-background/60 size-8 rounded-full" />
    </div>
  </div>
);

/**
 * The whole app before the chat runtime is ready: the real sidebar frame, so
 * nothing shifts when it fills in. `conversation` is whether the user had
 * conversations last visit: the newest one opens, so show its shape.
 */
export const AppSkeleton: FC<{ conversation: boolean }> = ({ conversation }) => {
  return (
    <SidebarProvider>
      <div className="flex h-dvh w-full pr-0.5">
        <Sidebar>
          <SidebarHeader>
            <div className="flex h-12 items-center gap-2 p-2">
              <Skeleton className="size-8 rounded-lg" />
              <Skeleton className="h-4 w-32" />
            </div>
          </SidebarHeader>
          <SidebarContent>
            <div className="flex flex-col items-stretch gap-1.5">
              <div className="mx-2 flex h-9 items-center gap-2 px-2.5">
                <Skeleton className="size-4 rounded-full" />
                <Skeleton className="h-4 w-24" />
              </div>
              <ThreadListLoading />
            </div>
          </SidebarContent>
          <SidebarFooter className="mb-3 gap-1">
            {[28, 20].map((width) => (
              <div key={width} className="flex h-12 items-center gap-2 p-2">
                <Skeleton className="size-8 rounded-lg" />
                <Skeleton className="h-4" style={{ width: `${width * 4}px` }} />
              </div>
            ))}
            {[24, 22].map((width) => (
              <div key={width} className="flex h-7 items-center gap-2 p-1.5">
                <Skeleton className="size-5 rounded-md" />
                <Skeleton className="h-3" style={{ width: `${width * 4}px` }} />
              </div>
            ))}
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div className="absolute top-[max(0.5rem,env(safe-area-inset-top))] left-[max(0.5rem,env(safe-area-inset-left))] z-20">
              <Skeleton className="size-11 rounded-full" />
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-8">
              {conversation ? <ConversationSkeleton /> : <WelcomeSkeleton />}
            </div>
            <ComposerSkeleton />
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
};
