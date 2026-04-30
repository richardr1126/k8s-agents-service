"use client";

import { useEffect, useState, type FC } from "react";
import { useMessagePartReasoning } from "@assistant-ui/react";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { MarkdownText } from "./markdown-text";

export const ReasoningPart: FC = () => {
  const reasoning = useMessagePartReasoning();
  const isStreaming = reasoning.status.type === "running";
  const [isOpen, setIsOpen] = useState(isStreaming);

  useEffect(() => {
    if (isStreaming) {
      setIsOpen(true);
    }
  }, [isStreaming, reasoning.text]);

  return (
    <details
      open={isOpen}
      onToggle={(event) => setIsOpen((event.currentTarget as HTMLDetailsElement).open)}
      className="mb-3 rounded-lg border border-border/70 bg-muted/40"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-muted-foreground">
        <span>{isStreaming ? "Thinking..." : "Thinking"}</span>
        <ChevronDownIcon
          className={cn(
            "size-4 transition-transform duration-200",
            isOpen && "rotate-180",
          )}
        />
      </summary>
      <div className="px-3 pb-3 pt-1 text-sm">
        <MarkdownText />
      </div>
    </details>
  );
};
