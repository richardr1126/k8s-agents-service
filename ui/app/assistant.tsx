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
import { Suspense } from "react";

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

function AssistantContent() {
  return (
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
  );
}

export const Assistant = () => {
  return (
    <Suspense fallback={<div className="flex h-dvh w-full items-center justify-center">Loading...</div>}>
      <AssistantContent />
    </Suspense>
  );
};
