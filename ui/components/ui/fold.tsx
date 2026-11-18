import type { FC, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Height animates between 0 and auto via grid rows, with a fade; reduced motion snaps. */
export const Fold: FC<{ open: boolean; delayOpen?: boolean; delayClose?: boolean; className?: string; children: ReactNode }> = ({
  open,
  delayOpen,
  delayClose,
  className,
  children,
}) => (
  <div
    aria-hidden={!open}
    inert={!open}
    className={cn(
      "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
      open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      open ? delayOpen && "delay-500" : delayClose && "delay-500",
    )}
  >
    <div className={cn("min-h-0 overflow-hidden", className)}>{children}</div>
  </div>
);
