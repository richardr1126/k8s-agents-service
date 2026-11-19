import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** A keyboard key, for shortcut hints. */
export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "bg-muted text-muted-foreground pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-0.5 rounded border px-1 font-sans text-[11px] font-medium",
        className,
      )}
      {...props}
    />
  );
}
