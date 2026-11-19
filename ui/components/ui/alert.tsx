import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  error: { icon: AlertTriangle, role: "alert", className: "border-destructive/30 bg-destructive/8 text-destructive" },
  success: { icon: CheckCircle2, role: "status", className: "border-success/30 bg-success/10 text-emerald-800 dark:text-success" },
  info: { icon: Info, role: "status", className: "bg-muted/60 text-foreground" },
} as const;

/** An inline message: a failed action, a confirmation, or a heads-up. */
export function Alert({ tone = "info", title, children, className }: { tone?: keyof typeof TONES; title?: ReactNode; children?: ReactNode; className?: string }) {
  const { icon: Icon, role, className: toneClass } = TONES[tone];
  return (
    <div role={role} className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm", toneClass, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && "opacity-90")}>{children}</div>}
      </div>
    </div>
  );
}
