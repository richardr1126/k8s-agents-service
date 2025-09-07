import { ToolCallContentPartComponent } from "@assistant-ui/react";
import { ChevronDownIcon, ChevronUpIcon, WrenchIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/button";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const ToolFallback: ToolCallContentPartComponent = ({
  toolName,
  argsText,
  result,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  
  const formatResult = (result: unknown) => {
    if (typeof result === "string") {
      return result;
    }
    return JSON.stringify(result, null, 2);
  };

  return (
    <div className="mb-4 w-full overflow-hidden rounded-xl border border-border/50 bg-gradient-to-br from-background via-background to-muted/20 shadow-sm">
      <div className="flex items-center gap-3 bg-muted/30 px-4 py-3 border-b border-border/30">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
          <WrenchIcon className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">
            Used tool: <span className="font-mono text-primary">{toolName}</span>
          </p>
        </div>
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
      </div>
      
      {!isCollapsed && (
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
