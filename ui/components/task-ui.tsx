"use client";

import { makeAssistantToolUI } from "@assistant-ui/react";
import { CheckCircle, XCircle, Clock, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { ReadonlyJSONObject } from "@/lib/types";

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
    <div className="space-y-2">
      {Object.entries(data).map(([key, value]) => {
        if (value === null || value === undefined) return null;

        let displayValue: string;
        if (typeof value === 'object') {
          displayValue = JSON.stringify(value, null, 2);
        } else {
          displayValue = String(value);
        }

        return (
          <div key={key} className="rounded-lg bg-muted/50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              {key}
            </div>
            <div className="text-sm text-foreground font-mono break-all">
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

  return (
    <div className={cn(
      "mb-4 w-full overflow-hidden rounded-xl border border-border/50 bg-gradient-to-br from-background via-background to-muted/20 shadow-sm",
      taskData.state === "new" && "border-l-4 border-l-blue-500",
      taskData.state === "running" && "border-l-4 border-l-blue-500",
      taskData.state === "complete" && taskData.result === "success" && "border-l-4 border-l-green-500",
      taskData.state === "complete" && taskData.result === "error" && "border-l-4 border-l-red-500"
    )}>
      <div className="flex items-center gap-3 bg-muted/30 px-4 py-3 border-b border-border/30">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
          {getStateIcon(taskData.state, taskData.result)}
        </div>

        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-foreground truncate">
            {taskData.name}
          </h4>
        </div>

        {isLoading ? (
          <div className="flex h-8 w-8 items-center justify-center">
            <Spinner className="text-muted-foreground" />
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="h-8 w-8 p-0 hover:bg-muted/50"
          >
            {isCollapsed ? (
              <ChevronDownIcon className="h-4 w-4" />
            ) : (
              <ChevronUpIcon className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>

      {!isCollapsed && (taskData.data && Object.keys(taskData.data).length > 0) && (
        <div className="p-4">
          {formatTaskData(taskData.data)}

          {taskData.data.error != null && (
            <div className="mt-3 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive">
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
