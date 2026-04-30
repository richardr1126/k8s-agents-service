"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { CheckCircle, XCircle, Clock, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { ReadonlyJSONObject } from "@/lib/types";
import { useContainerBreakpoint } from "@/hooks/use-container-breakpoint";

interface TaskData {
  name: string;
  run_id: string;
  state: "new" | "running" | "complete";
  result?: "success" | "error" | null;
  data: ReadonlyJSONObject;
}

interface TaskArgs {
  taskData: TaskData;
}

// No result needed for display-only component
type TaskResult = Record<string, never>;

const getStateIcon = (state: string, result?: string | null) => {
  switch (state) {
    case "new":
      return <Clock className="h-4 w-4 text-blue-500 dark:text-blue-400" />;
    case "running":
      return <Spinner className="text-blue-500 dark:text-blue-400" />;
    case "complete":
      return result === "error" ?
        <XCircle className="h-4 w-4 text-red-500 dark:text-red-400" /> :
        <CheckCircle className="h-4 w-4 text-green-500 dark:text-green-400" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
};

const formatTaskData = (data: ReadonlyJSONObject) => {
  if (!data || Object.keys(data).length === 0) return null;

  return (
    <div className="space-y-1.5">
      {Object.entries(data).map(([key, value]) => {
        if (value === null || value === undefined) return null;

        let displayValue: string;
        if (typeof value === 'object') {
          displayValue = JSON.stringify(value, null, 2);
        } else {
          displayValue = String(value);
        }

        return (
          <div key={key} className="rounded-md bg-muted/50 p-2.5">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {key}
            </div>
            <div className="break-all font-mono text-xs text-foreground">
              {displayValue}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const TaskUIComponent = ({ args }: { args: TaskArgs }) => {
  const { taskData } = args;
  const [isCollapsed, setIsCollapsed] = useState(true);
  const isLoading = taskData.state !== "complete";
  const { containerRef, isNarrow } = useContainerBreakpoint<HTMLDivElement>(560);

  return (
    <div ref={containerRef} className={cn(
      "mb-3 w-full overflow-hidden rounded-lg border border-border/50 bg-gradient-to-br from-background via-background to-muted/20 shadow-sm",
      taskData.state === "new" && "border-l-4 border-l-blue-500",
      taskData.state === "running" && "border-l-4 border-l-blue-500",
      taskData.state === "complete" && taskData.result === "success" && "border-l-4 border-l-green-500",
      taskData.state === "complete" && taskData.result === "error" && "border-l-4 border-l-red-500"
    )}>
      <div className="border-b border-border/30 bg-muted/30 px-2.5 py-1.5 sm:px-3">
        <div className={cn("flex min-w-0 gap-2", isNarrow ? "items-start" : "items-center")}>
          <div className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10",
            isNarrow ? "mt-0.5" : "mt-0",
          )}>
            {getStateIcon(taskData.state, taskData.result)}
          </div>

          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-medium text-foreground break-words sm:truncate">
              {taskData.name}
            </h4>
          </div>

          <div className={cn("shrink-0 items-center gap-0.5", isNarrow ? "hidden" : "flex")}>
            {isLoading ? (
              <div className="flex h-5 w-5 items-center justify-center">
                <Spinner className="text-muted-foreground" />
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="h-5 w-5 p-0 hover:bg-muted/50"
              >
                {isCollapsed ? (
                  <ChevronDownIcon className="h-3.5 w-3.5" />
                ) : (
                  <ChevronUpIcon className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
          </div>
        </div>

        <div className={cn(
          "mt-0 w-full items-center justify-end gap-0.5",
          isNarrow ? "flex" : "hidden",
        )}>
          {isLoading ? (
            <div className="flex h-5 w-5 items-center justify-center">
              <Spinner className="text-muted-foreground" />
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="h-5 w-5 p-0 hover:bg-muted/50"
            >
              {isCollapsed ? (
                <ChevronDownIcon className="h-3.5 w-3.5" />
              ) : (
                <ChevronUpIcon className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
        </div>
      </div>

      {!isCollapsed && (taskData.data && Object.keys(taskData.data).length > 0) && (
        <div className="p-3">
          {formatTaskData(taskData.data)}

          {taskData.data.error != null && (
            <div className="mt-2 rounded-md border border-destructive/20 bg-destructive/10 p-2.5">
              <p className="text-xs text-destructive">
                <strong>Error:</strong> {String(taskData.data.error)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const TaskToolUI = makeAssistantToolUI<TaskArgs, TaskResult>({
  toolName: "task_update",
  render: TaskUIComponent,
});
