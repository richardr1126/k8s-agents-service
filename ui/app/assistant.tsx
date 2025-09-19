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
import { useSession, signIn } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, MessagesSquare } from "lucide-react";

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

  // Auto sign-in anonymous users if not authenticated
  useEffect(() => {
    if (!isPending && !session) {
      // Don't redirect to signin, instead sign in anonymously
      const signInAnonymously = async () => {
        try {
          await signIn.anonymous();
          // Session will be updated automatically via the auth client
        } catch (error) {
          console.error('Failed to sign in anonymously:', error);
          // Fallback to signin page if anonymous auth fails
          router.push('/signin');
        }
      };
      
      signInAnonymously();
    }
  }, [session, isPending, router]);

  // Show loading state while checking auth or signing in
  if (isPending || !session) {
    return (
      <div className="flex h-dvh w-full items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="flex aspect-square size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <MessagesSquare className="size-6" />
              </div>
            </div>
            <CardTitle className="text-lg md:text-xl">chat.richardr.dev</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <div className="flex items-center justify-center gap-3 mb-4">
              <Loader2 className="size-5 animate-spin" />
              <span className="text-sm text-muted-foreground">
                {isPending ? "Checking authentication..." : "Signing in anonymously..."}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {isPending 
                ? "Please wait while we verify your session"
                : "Setting up your temporary session to get started"
              }
            </p>
          </CardContent>
        </Card>
      </div>
    );
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
