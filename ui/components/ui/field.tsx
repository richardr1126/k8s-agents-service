"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * A form field: label, control, then a hint or an error. The control gets the
 * id, aria-invalid and aria-describedby through the render function.
 */
export function Field({
  label,
  hint,
  error,
  action,
  required,
  className,
  children,
}: {
  label: ReactNode;
  /** Marks the label with an asterisk; the control still needs its own `required`. */
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  /** Right of the label, e.g. a "Forgot password?" link. */
  action?: ReactNode;
  className?: string;
  children: (control: { id: string; "aria-invalid"?: true; "aria-required"?: true; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error || hint;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-[13px]">
          {label}
          {required && (
            <span className="text-muted-foreground ml-0.5 font-normal" aria-hidden>
              *
            </span>
          )}
        </Label>
        {action}
      </div>
      {children({
        id,
        ...(error && { "aria-invalid": true as const }),
        ...(required && { "aria-required": true as const }),
        ...(note && { "aria-describedby": noteId }),
      })}
      {note && (
        <p id={noteId} className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
          {note}
        </p>
      )}
    </div>
  );
}

/** A password input with a show/hide toggle. */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input type={shown ? "text" : "password"} className={cn("pr-9", className)} {...props} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md outline-none focus-visible:ring-2"
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
