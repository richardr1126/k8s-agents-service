"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A titled group of settings rows. */
export function Section({ title, description, children, actions }: { title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap justify-end gap-1.5">{actions}</div>}
      </header>
      <div className="divide-y">{children}</div>
    </section>
  );
}

/** One setting: copy on the left, control on the right (stacked on phones). */
export function Row({ label, description, children, badge }: { label: string; description?: ReactNode; children: ReactNode; badge?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0 sm:max-w-[55%]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {badge}
        </div>
        {description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:items-end">{children}</div>
    </div>
  );
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "accent" | "warn" | "danger" | "ok" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "accent" && "bg-primary/10 text-primary",
        tone === "warn" && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
        tone === "danger" && "bg-red-500/15 text-red-700 dark:text-red-300",
        tone === "ok" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
      )}
    >
      {children}
    </span>
  );
}

const SOURCE_LABEL = { default: "Default", "json-seed": "From seed", admin: "Changed" } as const;

export function SourceBadge({ source }: { source: keyof typeof SOURCE_LABEL }) {
  return <Badge tone={source === "admin" ? "accent" : "muted"}>{SOURCE_LABEL[source]}</Badge>;
}

/** Radio cards for a small set of choices. */
export function Choice<T extends string>({
  value,
  onChange,
  options,
  name,
  disabled,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; hint?: string }[];
  name: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="grid w-full gap-2 sm:max-w-sm">
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
            value === option.value ? "border-primary bg-primary/5" : "hover:bg-muted/50",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <input
            type="radio"
            name={name}
            className="mt-0.5 accent-[var(--primary)]"
            checked={value === option.value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium">{option.label}</span>
            {option.hint && <span className="block text-xs text-muted-foreground">{option.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

/** A labelled on/off switch. */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input",
      )}
    >
      <span className={cn("pointer-events-none block size-5 rounded-full bg-background shadow transition-transform", checked ? "translate-x-5" : "translate-x-0")} />
    </button>
  );
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}
