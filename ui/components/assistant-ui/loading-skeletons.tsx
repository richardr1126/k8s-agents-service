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
  <div className="flex flex-col gap-px px-1" aria-hidden>
    <div className="px-2.5 pt-1 pb-1">
      <Skeleton className="h-3 w-12" />
    </div>
    {[78, 64, 90, 70, 84, 58].map((width) => (
      <div key={width} className="flex h-9 items-center px-2.5 md:h-8">
        <Skeleton className="h-3.5" style={{ width: `${width}%` }} />
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
      "mx-auto flex w-full max-w-[var(--thread-max-width,46rem)] flex-col px-[var(--thread-padding-x,1rem)] pt-4",
      delayed && "fade-in-late",
    )}
  >
    {[
      { user: "w-2/5", lines: ["w-full", "w-11/12", "w-3/4"] },
      { user: "w-1/3", lines: ["w-full", "w-5/6", "w-full", "w-2/3"] },
    ].map((turn, index) => (
      <div key={index}>
        <div className="flex justify-end py-3">
          <Skeleton className={cn("h-11 rounded-2xl", turn.user)} />
        </div>
        <div className="flex flex-col gap-3 py-4">
          {turn.lines.map((width, line) => (
            <Skeleton key={line} className={cn("h-4", width)} />
          ))}
        </div>
      </div>
    ))}
  </div>
);

const WelcomeSkeleton: FC = () => (
  <div className="mx-auto flex w-full max-w-[46rem] flex-grow flex-col justify-center px-4 pb-6" aria-hidden>
    <Skeleton className="size-10 rounded-xl" />
    <Skeleton className="mt-5 h-8 w-56 md:h-9 md:w-72" />
    <Skeleton className="mt-3 h-4 w-72 max-w-full md:w-96" />
  </div>
);

const ComposerSkeleton: FC = () => (
  <div className="mx-auto flex w-full max-w-[46rem] flex-col px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-4" aria-hidden>
    <div className="bg-background dark:bg-card flex flex-col rounded-xl border shadow-sm">
      <div className="min-h-[3.25rem]" />
      <div className="flex items-center justify-between px-2 pb-2">
        <div className="flex items-center gap-1">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-28" />
        </div>
        <Skeleton className="size-8 rounded-lg" />
      </div>
    </div>
    <div className="hidden h-[calc(0.75rem+16.5px)] md:block" />
  </div>
);

/**
 * The whole app before the chat runtime is ready: the real sidebar frame, so
 * nothing shifts when it fills in. `conversation` is whether the user had
 * conversations last visit: the newest one opens, so show its shape.
 */
export const AppSkeleton: FC<{ conversation: boolean }> = ({ conversation }) => (
  <SidebarProvider>
    <div className="flex h-dvh w-full">
      <Sidebar>
        <SidebarHeader className="px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-1">
          <div className="flex h-8 items-center gap-2 px-1">
            <Skeleton className="size-7 rounded-lg" />
            <Skeleton className="h-3.5 w-28" />
          </div>
        </SidebarHeader>
        <SidebarContent className="px-1">
          <div className="flex flex-col gap-1 px-1 pt-1 pb-2">
            <div className="bg-background dark:bg-card h-9 rounded-md border shadow-xs md:h-8" />
            <div className="flex h-9 items-center gap-2 px-2.5 md:h-8">
              <Skeleton className="size-3.5 rounded-full" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <ThreadListLoading />
        </SidebarContent>
        <SidebarFooter className="border-sidebar-border gap-1 border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-2.5 p-2">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <div className="flex h-[calc(3rem+env(safe-area-inset-top))] shrink-0 items-center px-2 pt-[env(safe-area-inset-top)] md:px-3">
          <Skeleton className="size-8 rounded-md" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {conversation ? <ConversationSkeleton /> : <WelcomeSkeleton />}
        </div>
        <ComposerSkeleton />
      </SidebarInset>
    </div>
  </SidebarProvider>
);
