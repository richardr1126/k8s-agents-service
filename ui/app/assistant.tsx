"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { AppSkeleton } from "@/components/assistant-ui/loading-skeletons";
import { Thread } from "@/components/assistant-ui/thread";
import { CustomRuntimeProvider } from "@/components/custom-runtime-provider";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useSession } from "@/lib/auth-client";

export const Assistant = ({ hadThreads }: { hadThreads: boolean }) => {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  // No session: the sign-in page offers accounts and "Continue as guest".
  useEffect(() => {
    if (!isPending && !session) router.replace("/signin");
  }, [isPending, session, router]);

  const skeleton = <AppSkeleton conversation={hadThreads} />;
  if (!session) return skeleton;

  return (
    // Remount per user so a sign-in or guest upgrade starts from that user's threads.
    <CustomRuntimeProvider key={session.user.id} fallback={skeleton}>
      <SidebarProvider>
        <div className="flex h-dvh w-full pr-0.5">
          <AppSidebar />
          <SidebarInset>
            <div className="min-h-0 relative flex-1">
              {/* On a phone the conversation scrolls under the sidebar button; fade it out there. */}
              <div className="from-background via-background/80 pointer-events-none absolute inset-x-0 top-0 z-10 h-[calc(3.5rem+env(safe-area-inset-top))] bg-gradient-to-b to-transparent md:hidden" />
              <div className="absolute top-[max(0.5rem,env(safe-area-inset-top))] left-[max(0.5rem,env(safe-area-inset-left))] z-20">
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
