"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { BrandMark } from "@/components/ui/brand-mark";
import { cn } from "@/lib/utils";

/**
 * The frame every account page shares (sign in, sign up, password reset):
 * the brand, a narrow column with a title, and quiet links underneath.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** A little more room, for the sign-up form. */
  wide?: boolean;
}) {
  return (
    <div className="relative flex min-h-dvh w-full flex-col">
      {/* A faint wash of the brand colour behind the form. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,var(--brand-soft),transparent)] opacity-70"
      />
      <header className="relative flex h-14 items-center px-4 pt-[env(safe-area-inset-top)] md:px-6">
        <Link href="/" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <BrandMark />
        </Link>
      </header>
      <main className="relative flex flex-1 items-start justify-center px-4 pt-[8vh] pb-10 md:items-center md:pt-0">
        <div className={cn("w-full", wide ? "max-w-md" : "max-w-sm")}>
          <div className="bg-background dark:bg-card rounded-xl border p-6 shadow-sm md:p-8">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="text-muted-foreground mt-1.5 text-sm">{description}</p>}
            <div className="mt-6 grid gap-4">{children}</div>
          </div>
          {footer && (
            <div className="text-muted-foreground mt-5 flex flex-col items-center gap-2 text-center text-[13px]">{footer}</div>
          )}
        </div>
      </main>
    </div>
  );
}

/** A link styled for the quiet text under an auth form. */
export function AuthLink({ className, ...props }: React.ComponentProps<typeof Link>) {
  return <Link className={cn("text-foreground font-medium underline-offset-4 hover:underline", className)} {...props} />;
}

/** A divider with a word in the middle, e.g. "or". */
export function AuthDivider({ children = "or" }: { children?: ReactNode }) {
  return (
    <div className="text-muted-foreground flex items-center gap-3 text-xs">
      <span className="bg-border h-px flex-1" />
      {children}
      <span className="bg-border h-px flex-1" />
    </div>
  );
}

export function Notice({ kind, children }: { kind: "error" | "success"; children: ReactNode }) {
  return <Alert tone={kind}>{children}</Alert>;
}
