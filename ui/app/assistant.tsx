"use client";

import { Thread } from "@/components/assistant-ui/thread";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { AgentSelect } from "@/components/agent-select";
import { ModelSelect } from "@/components/model-select";
import { CustomRuntimeProvider, useThreadContext } from "@/components/custom-runtime-provider";
import { TaskToolUI } from "@/components/task-ui";
import { UserProvider } from "@/components/auth-user-provider";
import { ServiceInfoProvider } from "@/components/service-info-provider";
import { useSession } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";

function AssistantHeader() {
  const {
    selectedAgentId,
    setSelectedAgentId,
    selectedModelId,
    setSelectedModelId,
  } = useThreadContext();

  return (
    <header
      className="border-b px-2 py-2 sm:py-0 flex flex-row gap-1 sm:h-16 sm:flex-row sm:items-center"
    >
      <div className="flex items-center gap-2">
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-4" />
      </div>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3 flex-1">
        <AgentSelect
          selectedAgentId={selectedAgentId}
            onAgentChange={setSelectedAgentId}
        />
        <ModelSelect
          selectedModelId={selectedModelId}
          onModelChange={setSelectedModelId}
        />
      </div>
    </header>
  );
}

function AuthenticatedContent() {
  return (
    <ServiceInfoProvider>
      <UserProvider>
        <CustomRuntimeProvider>
          <SidebarProvider>
            <div className="flex h-dvh w-full pr-0.5">
              <AppSidebar />
              <SidebarInset>
                <AssistantHeader />
                <div className="flex-1 overflow-hidden">
                  <Thread />
                  <TaskToolUI />
                </div>
              </SidebarInset>
            </div>
          </SidebarProvider>
        </CustomRuntimeProvider>
      </UserProvider>
    </ServiceInfoProvider>
  );
}

function AssistantContent() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  // Redirect to signin when not authenticated
  useEffect(() => {
    if (!isPending && !session) {
      router.push('/signin');
    }
  }, [session, isPending, router]);

  if (isPending) {
    return (
      <div className="flex h-dvh w-full items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return null; // Will redirect to signin via useEffect
  }

  return <AuthenticatedContent />;
}

export const Assistant = () => {
  return (
    <Suspense fallback={<div className="flex h-dvh w-full items-center justify-center">Loading...</div>}>
      <AssistantContent />
    </Suspense>
  );
};
