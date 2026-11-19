"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** A titled group of settings rows. */
export function Section({ title, description, children, actions }: { title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="bg-card overflow-hidden rounded-xl border shadow-xs">
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3.5 sm:px-5">
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
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:px-5 sm:items-start sm:justify-between sm:gap-6">
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

export { Badge } from "@/components/ui/badge";
export { Switch as Toggle } from "@/components/ui/switch";

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
            value === option.value ? "border-brand bg-brand-soft/60 ring-brand/20 ring-1" : "hover:bg-muted/50",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <input
            type="radio"
            name={name}
            className="mt-0.5 accent-[var(--brand)]"
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

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}
