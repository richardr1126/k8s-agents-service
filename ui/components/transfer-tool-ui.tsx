"use client";

import { ToolCallContentPartComponent } from "@assistant-ui/react";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DatabaseIcon,
  GlobeIcon,
  UserIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { MarkdownString } from "./assistant-ui/markdown-string";
import { cn } from "@/lib/utils";
import { useThreadContext } from "@/components/custom-runtime-provider";
import { useContainerBreakpoint } from "@/hooks/use-container-breakpoint";

const SUBAGENT_TYPE_TO_AGENT: Record<string, string> = {
  resume: "resume-agent",
  web: "web-rag-agent",
  postgres: "postgres-mcp-agent",
};

const getAgentIcon = (agentName: string) => {
  switch (agentName) {
    case "web-rag-agent":
      return <GlobeIcon className="h-4 w-4 text-blue-500 dark:text-blue-400" />;
    case "resume-agent":
      return <UserIcon className="h-4 w-4 text-green-500 dark:text-green-400" />;
    case "postgres-mcp-agent":
      return <DatabaseIcon className="h-4 w-4 text-amber-500 dark:text-amber-400" />;
    default:
      return <ArrowRightIcon className="h-4 w-4 text-purple-500 dark:text-purple-400" />;
  }
};

const getAgentDisplayName = (agentName: string) => {
  switch (agentName) {
    case "web-rag-agent":
      return "Web Research Agent";
    case "resume-agent":
      return "Resume Agent";
    case "postgres-mcp-agent":
      return "Postgres Database Agent";
    default:
      return agentName.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  }
};

const getAgentDescription = (agentName: string) => {
  switch (agentName) {
    case "web-rag-agent":
      return "Searching the web for current information";
    case "resume-agent":
      return "Searching resume and project information";
    case "postgres-mcp-agent":
      return "Querying the Cosmere Feed database";
    default:
      return `Transferring to ${getAgentDisplayName(agentName)}`;
  }
};

const parseTaskArgs = (
  argsText: string | undefined,
): { subagentType?: string; description?: string } => {
  if (!argsText) return {};
  try {
    const parsed = JSON.parse(argsText) as {
      subagent_type?: string;
      description?: string;
    };
    return {
      subagentType: parsed.subagent_type,
      description: parsed.description,
    };
  } catch {
    return {};
  }
};

const formatResult = (result: unknown): string => {
  if (typeof result === "string") return result;
  return JSON.stringify(result, null, 2);
};

export const TransferToolFallback: ToolCallContentPartComponent = ({
  toolName,
  argsText,
  result,
  toolCallId,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const { openSubAgentBranch, resolveTaskBranchId, canOpenTaskBranch } = useThreadContext();
  const { containerRef, isNarrow } = useContainerBreakpoint<HTMLDivElement>(560);

  const { subagentType, description: taskDescription } = parseTaskArgs(argsText);
  const agentName = subagentType
    ? SUBAGENT_TYPE_TO_AGENT[subagentType] ?? subagentType
    : "task";
  const description = taskDescription || getAgentDescription(agentName);

  const hasDetails = Boolean(argsText || result !== undefined);
  const canExpandDetails = result !== undefined && hasDetails;
  const branchId = toolName === "task" ? resolveTaskBranchId(toolCallId) : null;
  const canOpenBranch = toolName === "task" ? canOpenTaskBranch(toolCallId) : false;

  return (
    <div
      ref={containerRef}
      className={cn(
        "w-full overflow-hidden rounded-lg border border-border/50 bg-gradient-to-br from-background via-background to-muted/20 shadow-sm",
        "border-l-4 border-l-purple-500",
      )}
    >
      <div
        className={cn(
          "flex flex-col gap-1 bg-muted/30 px-2.5 sm:px-3",
          isCollapsed ? "py-1.5" : "border-b border-border/30 py-1.5",
        )}
      >
        <div className={cn("flex min-w-0 gap-2", isNarrow ? "items-start" : "items-center")}>
          <div className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10",
            isNarrow ? "mt-0.5" : "mt-0",
          )}>
            {getAgentIcon(agentName)}
          </div>

          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-medium text-foreground break-words sm:truncate">
              Transferred to {getAgentDisplayName(agentName)}
            </h4>

            <p className="mt-0 text-xs leading-tight text-muted-foreground break-words">
              {description}
            </p>
          </div>

          <div className={cn("shrink-0 items-center gap-0.5", isNarrow ? "hidden" : "flex")}>
            {branchId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openSubAgentBranch(branchId)}
                className="h-5 justify-center px-1.5 text-[11px] hover:bg-muted/50"
                disabled={!canOpenBranch}
                title="Show sub-agent stream"
                aria-label="Open sub-agent stream"
              >
                <ArrowRightIcon className="mr-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                Show sub-agent
              </Button>
            )}

            {canExpandDetails ? (
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
            ) : (
              <div className="flex h-5 w-5 items-center justify-center">
                <Spinner className="text-muted-foreground" />
              </div>
            )}
          </div>
        </div>

        <div className={cn(
          "mt-0 w-full items-center justify-end gap-0.5",
          isNarrow ? "flex" : "hidden",
        )}>
          {branchId && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openSubAgentBranch(branchId)}
              className="h-5 flex-1 justify-center px-1.5 text-[11px] hover:bg-muted/50"
              disabled={!canOpenBranch}
              title="Show sub-agent stream"
              aria-label="Open sub-agent stream"
            >
              <ArrowRightIcon className="mr-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Show sub-agent
            </Button>
          )}

          {canExpandDetails ? (
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
          ) : (
            <div className="flex h-5 w-5 items-center justify-center">
              <Spinner className="text-muted-foreground" />
            </div>
          )}
        </div>

      </div>

      {!isCollapsed && canExpandDetails && (
        <div className="divide-y divide-border/30">
          {argsText && (
            <div className="p-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Arguments
              </p>
              <div className="rounded-md bg-muted/50 p-2.5">
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                  {argsText}
                </pre>
              </div>
            </div>
          )}

          {result !== undefined && (
            <div className="p-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Sub-agent Final Message
              </p>
              <div className="max-h-72 overflow-y-auto rounded-md bg-muted/50 p-2.5">
                <MarkdownString>{formatResult(result)}</MarkdownString>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
