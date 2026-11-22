import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** A markdown link; one whose text is just a number is a citation and shows as a small chip. */
export function MarkdownLink({ className, children, ...props }: ComponentProps<"a">) {
  if (typeof children === "string" && /^\d{1,3}$/.test(children.trim())) {
    return (
      <a
        className={cn(
          "bg-muted text-muted-foreground hover:bg-brand-soft hover:text-brand mx-0.5 inline-flex h-4 min-w-4 -translate-y-px items-center justify-center rounded px-1 align-middle text-[10px] font-semibold no-underline transition-colors",
          className,
        )}
        target="_blank"
        rel="noopener noreferrer"
        title={props.href}
        {...props}
      >
        {children.trim()}
      </a>
    );
  }
  return (
    <a className={cn("text-primary font-medium underline underline-offset-4", className)} {...props}>
      {children}
    </a>
  );
}
