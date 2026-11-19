"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { AppSkeleton } from "@/components/assistant-ui/loading-skeletons";
import { Thread } from "@/components/assistant-ui/thread";
import { ChatHeader } from "@/components/chat-header";
import { CustomRuntimeProvider } from "@/components/custom-runtime-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
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
        <div className="flex h-dvh w-full">
          <AppSidebar />
          <SidebarInset className="min-w-0">
            <ChatHeader />
            <div className="relative min-h-0 flex-1">
              <Thread />
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </CustomRuntimeProvider>
  );
};
