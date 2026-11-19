"use client";

import { MessageSquareDashedIcon, PlusIcon, SettingsIcon, Trash2Icon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, PasswordInput } from "@/components/ui/field";
import { Fold } from "@/components/ui/fold";
import { GitHubIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";

const TOKENS = [
  "background", "foreground", "card", "muted", "muted-foreground", "accent", "border", "input",
  "primary", "brand", "brand-soft", "success", "warning", "destructive", "sidebar", "subagent",
];
const BUTTON_VARIANTS = ["default", "brand", "outline", "secondary", "ghost", "destructive", "link"] as const;
const BADGE_TONES: BadgeTone[] = ["muted", "accent", "ok", "warn", "danger", "outline"];

function Demo({ title, file, children }: { title: string; file: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <div className="flex items-baseline justify-between gap-3 border-b pb-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <code className="text-muted-foreground text-xs">{file}</code>
      </div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

/** Every shared component in its main states. Open /dev/ui while running `pnpm dev`. */
export function UiGallery() {
  const [on, setOn] = useState(true);
  const [open, setOpen] = useState(false);
  const toggleTheme = () => {
    const dark = document.documentElement.classList.contains("dark");
    window.__setTheme?.(dark ? "light" : "dark");
  };

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-10 px-4 py-10">
      <header className="flex items-center justify-between gap-3">
        <div>
          <BrandMark />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">UI components</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            The shared pieces in <code>components/ui</code>. Build screens from these before writing new styles.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={toggleTheme}>
          Toggle theme
        </Button>
      </header>

      <Demo title="Color tokens" file="app/globals.css">
        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
          {TOKENS.map((token) => (
            <div key={token} className="flex items-center gap-2 text-xs">
              <span className="size-6 shrink-0 rounded-md border" style={{ background: `var(--${token})` }} />
              <code>{token}</code>
            </div>
          ))}
        </div>
      </Demo>

      <Demo title="Button" file="ui/button.tsx">
        {BUTTON_VARIANTS.map((variant) => (
          <Button key={variant} variant={variant}>
            {variant}
          </Button>
        ))}
        <Button size="sm"><PlusIcon />Small</Button>
        <Button size="xs" variant="outline">Extra small</Button>
        <Button size="icon-sm" variant="ghost" aria-label="Settings"><SettingsIcon /></Button>
        <Button disabled><Spinner />Working</Button>
        <Button variant="outline"><GitHubIcon />Continue with GitHub</Button>
      </Demo>

      <Demo title="Badge" file="ui/badge.tsx">
        {BADGE_TONES.map((tone) => (
          <Badge key={tone} tone={tone}>{tone}</Badge>
        ))}
      </Demo>

      <Demo title="Alert" file="ui/alert.tsx">
        <div className="grid w-full gap-2">
          <Alert tone="error">Wrong email or password.</Alert>
          <Alert tone="success" title="Check your email">We sent a confirmation link.</Alert>
          <Alert tone="info">Changes apply on each person&apos;s next request.</Alert>
        </div>
      </Demo>

      <Demo title="Field, Input, PasswordInput" file="ui/field.tsx">
        <div className="grid w-full gap-4 sm:grid-cols-2">
          <Field label="Email" hint="We never share it.">
            {(control) => <Input {...control} placeholder="you@example.com" />}
          </Field>
          <Field label="Password" error="Enter your password." action={<a className="text-muted-foreground text-xs">Forgot?</a>}>
            {(control) => <PasswordInput {...control} />}
          </Field>
        </div>
      </Demo>

      <Demo title="Switch, Checkbox" file="ui/switch.tsx · ui/checkbox.tsx">
        <Switch label="Example" checked={on} onChange={setOn} />
        <Switch label="Disabled" checked={false} onChange={() => {}} disabled />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox defaultChecked /> Keep me signed in
        </label>
      </Demo>

      <Demo title="DropdownMenu" file="ui/dropdown-menu.tsx">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">Open menu</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">you@example.com</DropdownMenuLabel>
            <DropdownMenuItem><SettingsIcon />Settings<DropdownMenuShortcut>⌘,</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive"><Trash2Icon />Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Demo>

      <Demo title="Kbd, Spinner, Skeleton" file="ui/kbd.tsx · ui/spinner.tsx · ui/skeleton.tsx">
        <span className="flex gap-0.5"><Kbd>⌘</Kbd><Kbd>⇧</Kbd><Kbd>O</Kbd></span>
        <Spinner className="text-muted-foreground" />
        <div className="grid w-48 gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </Demo>

      <Demo title="Fold" file="ui/fold.tsx">
        <div className="w-full">
          <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
            {open ? "Fold away" : "Unfold"}
          </Button>
          <Fold open={open}>
            <p className="text-muted-foreground mt-3 rounded-lg border p-3 text-sm">
              Height animates between zero and its content, and snaps under reduced motion.
            </p>
          </Fold>
        </div>
      </Demo>

      <Demo title="EmptyState" file="ui/empty-state.tsx">
        <div className="w-full rounded-xl border">
          <EmptyState icon={MessageSquareDashedIcon} title="No conversations yet" description="Your chats will show up here." />
        </div>
      </Demo>
    </div>
  );
}
