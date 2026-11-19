import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "muted" | "accent" | "warn" | "danger" | "ok" | "outline";

/** A small status pill. */
export function Badge({ children, tone = "muted", className }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium leading-none whitespace-nowrap",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "accent" && "bg-brand-soft text-brand",
        tone === "warn" && "bg-warning/15 text-amber-700 dark:text-warning",
        tone === "danger" && "bg-destructive/12 text-destructive",
        tone === "ok" && "bg-success/15 text-emerald-700 dark:text-success",
        tone === "outline" && "text-muted-foreground border",
        className,
      )}
    >
      {children}
    </span>
  );
}
