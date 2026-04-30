import { ToolCallContentPartComponent } from "@assistant-ui/react";
import { ChevronDownIcon, ChevronUpIcon, WrenchIcon, SearchIcon, CalculatorIcon, CloudIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/button";
import { MarkdownString } from "./markdown-string";
import { TransferToolFallback } from "../transfer-tool-ui";
import { cn } from "@/lib/utils";
import { Spinner } from "../ui/spinner";
import { useContainerBreakpoint } from "@/hooks/use-container-breakpoint";

const getToolIcon = (toolName: string) => {
  const name = toolName.toLowerCase();
  if (name.includes("search") || name.includes("web")) {
    return <SearchIcon className="h-4 w-4 text-blue-500 dark:text-blue-400" />;
  }
  if (name.includes("calculator") || name.includes("math")) {
    return <CalculatorIcon className="h-4 w-4 text-green-500 dark:text-green-400" />;
  }
  if (name.includes("weather") || name.includes("climate")) {
    return <CloudIcon className="h-4 w-4 text-cyan-500 dark:text-cyan-400" />;
  }
  return <WrenchIcon className="h-4 w-4 text-orange-500 dark:text-orange-400" />;
};

const getToolBorderColor = (toolName: string) => {
  const name = toolName.toLowerCase();
  if (name.includes("search") || name.includes("web")) {
    return "border-l-blue-500";
  }
  if (name.includes("calculator") || name.includes("math")) {
    return "border-l-green-500";
  }
  if (name.includes("weather") || name.includes("climate")) {
    return "border-l-cyan-500";
  }
  return "border-l-orange-500";
};

const getToolDisplayName = (toolName: string) => {
  // Convert snake_case and kebab-case to Title Case
  return toolName
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, l => l.toUpperCase());
};

const isSearchTool = (toolName: string) => {
  const name = toolName.toLowerCase();
  return name.includes("search") || name.includes("web");
};

const extractSearchQuery = (argsText?: string): string | null => {
  if (!argsText) return null;
  try {
    const parsed = JSON.parse(argsText) as Record<string, unknown>;
    const directQuery = parsed.query;
    if (typeof directQuery === "string" && directQuery.trim()) return directQuery.trim();

    const directQ = parsed.q;
    if (typeof directQ === "string" && directQ.trim()) return directQ.trim();

    const searchQuery = parsed.search_query;
    if (Array.isArray(searchQuery)) {
      const first = searchQuery[0];
      if (first && typeof first === "object") {
        const q = (first as Record<string, unknown>).q;
        if (typeof q === "string" && q.trim()) return q.trim();
      }
    }
  } catch {
    return null;
  }
  return null;
};

export const ToolFallback: ToolCallContentPartComponent = (props) => {
  const { toolName, argsText, result } = props;
  const [isCollapsed, setIsCollapsed] = useState(true);
  const hasDetails = Boolean(argsText || result !== undefined);
  const isLoading = result === undefined;
  const searchQuery = isSearchTool(toolName) ? extractSearchQuery(argsText) : null;
  const { containerRef, isNarrow } = useContainerBreakpoint<HTMLDivElement>(560);

  // Main-agent dispatch tool uses a dedicated transfer card.
  if (toolName === "task") {
    return <TransferToolFallback {...props} />;
  }
  
  const formatResult = (result: unknown) => {
    if (typeof result === "string") {
      return result;
    }
    return JSON.stringify(result, null, 2);
  };

  return (
    <div ref={containerRef} className={cn(
      "w-full overflow-hidden rounded-lg border border-border/50 bg-gradient-to-br from-background via-background to-muted/20 shadow-sm",
      "border-l-4",
      getToolBorderColor(toolName)
    )}>
      <div className={cn(
        "bg-muted/30 px-2.5",
        isCollapsed ? "py-1.5" : "border-b border-border/30 py-1.5"
      )}>
        <div className={cn("flex min-w-0 gap-1.5", isNarrow ? "items-start" : "items-center")}>
          <div className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10",
            isNarrow ? "mt-0.5" : "mt-0",
          )}>
            {getToolIcon(toolName)}
          </div>

          <div className="min-w-0 flex-1">
            {searchQuery ? (
              <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm leading-snug">
                <span className="font-medium text-foreground">{getToolDisplayName(toolName)}</span>
                <span className="max-w-full break-words rounded bg-muted/40 px-1 py-0 text-[11px] text-muted-foreground">
                  {searchQuery}
                </span>
              </div>
            ) : (
              <h4 className="break-words text-sm font-medium text-foreground sm:truncate">
                {getToolDisplayName(toolName)}
              </h4>
            )}
            {!searchQuery && !isCollapsed && (
              <p className="mt-0.5 break-words text-xs text-muted-foreground">
                ReAct agentic tool execution {result !== undefined ? 'completed' : 'in progress'}
              </p>
            )}
          </div>

          <div className={cn("shrink-0 items-center gap-0.5", isNarrow ? "hidden" : "flex")}>
            {isLoading ? (
              <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                <Spinner className="text-muted-foreground" />
              </div>
            ) : hasDetails ? (
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
            ) : null}
          </div>
        </div>

        <div className={cn(
          "mt-0 w-full items-center justify-end gap-0.5",
          isNarrow ? "flex" : "hidden",
        )}>
          {isLoading ? (
            <div className="flex h-5 w-5 shrink-0 items-center justify-center">
              <Spinner className="text-muted-foreground" />
            </div>
          ) : hasDetails ? (
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
          ) : null}
        </div>
      </div>
      
      {!isCollapsed && hasDetails && (
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
                Result
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
