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
      className={cn(
        "w-full overflow-hidden rounded-xl border border-border/50 bg-gradient-to-br from-background via-background to-muted/20 shadow-sm",
        "border-l-4 border-l-purple-500",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-3 bg-muted/30 px-4",
          isCollapsed ? "py-3" : "py-3 border-b border-border/30",
        )}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
          {getAgentIcon(agentName)}
        </div>

        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-foreground truncate">
            Transferred to {getAgentDisplayName(agentName)}
          </h4>

          <p className="text-sm text-muted-foreground mt-1">
            {description}
          </p>
        </div>

        {branchId ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openSubAgentBranch(branchId)}
            className="h-7 px-2 text-xs hover:bg-muted/50"
            disabled={!canOpenBranch}
            title="Show sub-agent stream"
            aria-label="Open sub-agent stream"
          >
            <ArrowRightIcon className="h-4 w-4 text-muted-foreground mr-1" />
            Show sub-agent
          </Button>
        ) : (
          <ArrowRightIcon className="h-4 w-4 text-muted-foreground" />
        )}

        {canExpandDetails ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="h-7 w-7 p-0 hover:bg-muted/50"
          >
            {isCollapsed ? (
              <ChevronDownIcon className="h-4 w-4" />
            ) : (
              <ChevronUpIcon className="h-4 w-4" />
            )}
          </Button>
        ) : (
          <div className="flex h-7 w-7 items-center justify-center">
            <Spinner className="text-muted-foreground" />
          </div>
        )}
      </div>

      {!isCollapsed && canExpandDetails && (
        <div className="divide-y divide-border/30">
          {argsText && (
            <div className="p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Arguments
              </p>
              <div className="rounded-lg bg-muted/50 p-3">
                <pre className="text-sm text-muted-foreground overflow-x-auto whitespace-pre-wrap font-mono">
                  {argsText}
                </pre>
              </div>
            </div>
          )}

          {result !== undefined && (
            <div className="p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Sub-agent Final Message
              </p>
              <div className="rounded-lg bg-muted/50 p-3 max-h-96 overflow-y-auto">
                <MarkdownString>{formatResult(result)}</MarkdownString>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
