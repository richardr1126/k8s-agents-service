import { ToolCallContentPartComponent } from "@assistant-ui/react";
import { ChevronDownIcon, ChevronUpIcon, WrenchIcon, SearchIcon, CalculatorIcon, CloudIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/button";
import { MarkdownString } from "./markdown-string";
import { TransferToolFallback } from "../transfer-tool-ui";
import { cn } from "@/lib/utils";
import { Spinner } from "../ui/spinner";

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

export const ToolFallback: ToolCallContentPartComponent = (props) => {
  const { toolName, argsText, result } = props;
  const [isCollapsed, setIsCollapsed] = useState(true);
  const hasDetails = Boolean(argsText || result !== undefined);
  const isLoading = result === undefined;

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
    <div className={cn(
      "w-full overflow-hidden rounded-lg border border-border/50 bg-gradient-to-br from-background via-background to-muted/20 shadow-sm",
      "border-l-4",
      getToolBorderColor(toolName)
    )}>
      <div className={cn(
        "flex items-center gap-2 bg-muted/30 px-3",
        isCollapsed ? "py-2" : "py-3 border-b border-border/30"
      )}>
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
          {getToolIcon(toolName)}
        </div>
        
        <div className="flex-1 min-w-0">
          <h4 className="truncate text-sm font-medium text-foreground">
            {getToolDisplayName(toolName)}
          </h4>
          {!isCollapsed && (
            <p className="mt-1 text-xs text-muted-foreground">
              ReAct agentic tool execution {result !== undefined ? 'completed' : 'in progress'}
            </p>
          )}
        </div>

        {isLoading ? (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center">
            <Spinner className="text-muted-foreground" />
          </div>
        ) : hasDetails ? (
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
        ) : null}
      </div>
      
      {!isCollapsed && hasDetails && (
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
                Result
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
