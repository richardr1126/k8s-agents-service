import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { CalculatorIcon, ChevronDownIcon, CloudIcon, SearchIcon, WrenchIcon } from "lucide-react";
import { useState } from "react";
import { Fold } from "@/components/ui/fold";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { MarkdownString } from "./markdown-string";

export const getToolIcon = (toolName: string, className?: string) => {
  const name = toolName.toLowerCase();
  const cls = cn("size-3.5 shrink-0", className);
  if (name.includes("search") || name.includes("web")) return <SearchIcon className={cn(cls, "text-blue-500 dark:text-blue-400")} />;
  if (name.includes("calculator") || name.includes("math"))
    return <CalculatorIcon className={cn(cls, "text-green-500 dark:text-green-400")} />;
  if (name.includes("weather") || name.includes("climate")) return <CloudIcon className={cn(cls, "text-cyan-500 dark:text-cyan-400")} />;
  return <WrenchIcon className={cn(cls, "text-orange-500 dark:text-orange-400")} />;
};

export const getToolDisplayName = (toolName: string) =>
  toolName.replace(/[_-]/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

const isSearchTool = (toolName: string) => {
  const name = toolName.toLowerCase();
  return name.includes("search") || name.includes("web");
};

const extractSearchQuery = (argsText?: string): string | null => {
  if (!argsText) return null;
  try {
    const parsed = JSON.parse(argsText) as Record<string, unknown>;
    for (const key of ["query", "q"]) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    const searchQuery = parsed.search_query;
    if (Array.isArray(searchQuery) && searchQuery[0] && typeof searchQuery[0] === "object") {
      const q = (searchQuery[0] as Record<string, unknown>).q;
      if (typeof q === "string" && q.trim()) return q.trim();
    }
  } catch {
    return null;
  }
  return null;
};

/** The one argument that says what a non-search tool is doing: the workflow, skill or page. */
const extractDetail = (argsText?: string): string | null => {
  if (!argsText) return null;
  try {
    const parsed = JSON.parse(argsText) as Record<string, unknown>;
    for (const key of ["workflow", "name", "url"]) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {
    return null;
  }
  return null;
};

const formatResult = (result: unknown) => (typeof result === "string" ? result : JSON.stringify(result, null, 2));

/** One tool call as a slim outlined row; opens to show its arguments and result. */
export const ToolFallback: ToolCallMessagePartComponent = ({ toolName, argsText, result }) => {
  const [open, setOpen] = useState(false);
  const isLoading = result === undefined;
  const hasDetails = Boolean(argsText || !isLoading);
  const searchQuery = isSearchTool(toolName) ? extractSearchQuery(argsText) : extractDetail(argsText);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-border/70 text-sm",
        // Back-to-back rows join into one stacked list.
        "[[data-tool-row]:has(+[data-tool-row])>&]:rounded-b-none",
        "[[data-tool-row]+[data-tool-row]>&]:rounded-t-none [[data-tool-row]+[data-tool-row]>&]:border-t-0",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={!hasDetails}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 px-2 py-1 text-left transition-colors enabled:hover:bg-muted/40"
      >
        {getToolIcon(toolName)}
        <span className="shrink-0 font-medium">{getToolDisplayName(toolName)}</span>
        {searchQuery && <span className="min-w-0 truncate text-xs text-muted-foreground">{searchQuery}</span>}
        <span className="ml-auto flex shrink-0 items-center pl-1 text-muted-foreground">
          {isLoading ? (
            <Spinner className="size-3.5" />
          ) : (
            <ChevronDownIcon className={cn("size-3.5 transition-transform duration-300", open && "rotate-180")} />
          )}
        </span>
      </button>

      <Fold open={open && hasDetails}>
        <div className="space-y-2 border-t border-dashed border-border/70 px-2.5 py-2">
          {argsText && (
            <section>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Arguments</p>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-muted/40 px-2 py-1.5 font-mono text-xs text-muted-foreground">
                {argsText}
              </pre>
            </section>
          )}
          {!isLoading && (
            <section>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Result</p>
              <div className="max-h-72 overflow-y-auto rounded bg-muted/40 px-2 py-1.5 text-xs">
                <MarkdownString>{formatResult(result)}</MarkdownString>
              </div>
            </section>
          )}
        </div>
      </Fold>
    </div>
  );
};

/** Consecutive tool calls stack tightly; the last one before text leaves room. */
export const toolSpacing = "mb-1.5 [&:not(:has(+[data-tool]))]:mb-4";

/** A tool row as a message part: joined to neighbouring rows, spaced from anything else. */
export const ToolRow: ToolCallMessagePartComponent = (props) => (
  <div
    data-tool
    data-tool-row
    className="mb-4 [&:has(+[data-tool-row])]:mb-0 [&:has(+[data-tool]:not([data-tool-row]))]:mb-1.5"
  >
    <ToolFallback {...props} />
  </div>
);
