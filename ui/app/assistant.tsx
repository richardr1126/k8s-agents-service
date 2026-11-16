"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { Thread, ThreadLoadingSkeleton } from "@/components/assistant-ui/thread";
import { CustomRuntimeProvider } from "@/components/custom-runtime-provider";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useSession } from "@/lib/auth-client";

export const Assistant = () => {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  // No session: the sign-in page offers accounts and "Continue as guest".
  useEffect(() => {
    if (!isPending && !session) router.replace("/signin");
  }, [isPending, session, router]);

  if (!session) return <ThreadLoadingSkeleton />;

  return (
    // Remount per user so a sign-in or guest upgrade starts from that user's threads.
    <CustomRuntimeProvider key={session.user.id} fallback={<ThreadLoadingSkeleton />}>
      <SidebarProvider>
        <div className="flex h-dvh w-full pr-0.5">
          <AppSidebar />
          <SidebarInset>
            <div className="min-h-0 relative flex-1">
              <div className="absolute top-2 left-2 z-20">
                <SidebarTrigger className="rounded-full border size-11 bg-background/80 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/60" />
              </div>
              <Thread />
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </CustomRuntimeProvider>
  );
};
