import { ToolCallContentPartComponent } from "@assistant-ui/react";
import { ChevronDownIcon, ChevronUpIcon, WrenchIcon, SearchIcon, CalculatorIcon, CloudIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/button";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TransferToolFallback } from "../transfer-tool-ui";
import { cn } from "@/lib/utils";

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
  
  // Check if this is a transfer tool and use the custom component
  if (toolName.startsWith("transfer_to_")) {
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
      "w-full overflow-hidden rounded-xl border border-border/50 bg-gradient-to-br from-background via-background to-muted/20 shadow-sm",
      "border-l-4",
      getToolBorderColor(toolName)
    )}>
      <div className="flex items-center gap-3 bg-muted/30 px-4 py-3 border-b border-border/30">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
          {getToolIcon(toolName)}
        </div>
        
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-foreground truncate">
            {getToolDisplayName(toolName)}
          </h4>
          <p className="text-sm text-muted-foreground mt-1">
            ReAct agentic tool execution {result !== undefined ? 'completed' : 'in progress'}
          </p>
        </div>
        
        {(argsText || result !== undefined) && (
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
      
      {!isCollapsed && (argsText || result !== undefined) && (
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
                <div className="prose prose-sm max-w-none dark:prose-invert prose-pre:bg-background prose-pre:border prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded">
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]}
                    components={{
                      pre: ({ children, ...props }) => (
                        <pre {...props} className="bg-background border rounded p-3 overflow-x-auto">
                          {children}
                        </pre>
                      ),
                      code: ({ children, className, ...props }) => {
                        const isInline = !className;
                        return (
                          <code
                            className={`${
                              isInline 
                                ? "bg-muted px-1 py-0.5 rounded text-sm" 
                                : "block"
                            } font-mono`}
                            {...props}
                          >
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {formatResult(result)}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
