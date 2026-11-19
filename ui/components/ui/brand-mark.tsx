import { MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";

/** The app's mark and name. */
export function BrandMark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="bg-foreground text-background flex size-7 shrink-0 items-center justify-center rounded-lg">
        <MessagesSquare className="size-3.5" />
      </span>
      {!compact && <span className="truncate text-sm font-semibold tracking-tight">chat.richardr.dev</span>}
    </span>
  );
}
