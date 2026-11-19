import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A quiet placeholder for an empty list or panel. */
export function EmptyState({ icon: Icon, title, description, action, className }: { icon: LucideIcon; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-4 py-8 text-center", className)}>
      <span className="bg-muted text-muted-foreground flex size-9 items-center justify-center rounded-full">
        <Icon className="size-4" />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="text-muted-foreground max-w-64 text-xs">{description}</p>}
      {action}
    </div>
  );
}
