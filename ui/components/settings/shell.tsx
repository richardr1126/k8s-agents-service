"use client";

import { ArrowLeft, AudioLines, Gauge, Mail, Shield, Sparkles, User, Users } from "lucide-react";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountSettings } from "@/components/settings/account";
import { AccessSettings, LimitSettings, ModelSettings, SettingsProvider } from "@/components/settings/admin-settings";
import { EmailSettings } from "@/components/settings/admin-email";
import { SpeechSettings } from "@/components/settings/admin-speech";
import { UserAdmin } from "@/components/settings/admin-users";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "account", label: "Account", icon: User, admin: false },
  { id: "access", label: "Access", icon: Shield, admin: true },
  { id: "limits", label: "Run limits", icon: Gauge, admin: true },
  { id: "models", label: "Models", icon: Sparkles, admin: true },
  { id: "speech", label: "Speech", icon: AudioLines, admin: true },
  { id: "email", label: "Email", icon: Mail, admin: true },
  { id: "users", label: "Users", icon: Users, admin: true },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SettingsShell({ isAdmin, emailEnabled }: { isAdmin: boolean; emailEnabled: boolean }) {
  const tabs = TABS.filter((t) => isAdmin || !t.admin);
  const [tab, setTab] = useState<TabId>("account");

  // The tab lives in the URL hash so a reload or shared link opens the same one.
  useEffect(() => {
    const read = () => {
      const id = window.location.hash.slice(1) as TabId;
      if (tabs.some((t) => t.id === id)) setTab(id);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [tabs]);

  const select = (id: TabId) => {
    setTab(id);
    history.replaceState(null, "", `#${id}`);
  };

  const nav = (group: "you" | "admin") =>
    tabs
      .filter((t) => (group === "admin") === t.admin)
      .map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => select(t.id)}
          aria-current={tab === t.id ? "page" : undefined}
          className={cn(
            "focus-visible:ring-ring flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-[13px] transition-colors outline-none focus-visible:ring-2",
            tab === t.id
              ? "bg-accent text-foreground font-medium"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          )}
        >
          <t.icon className="size-3.5" />
          {t.label}
        </button>
      ));

  const content = (
    <>
      {tab === "account" && <AccountSettings emailEnabled={emailEnabled} />}
      {tab === "access" && <AccessSettings />}
      {tab === "limits" && <LimitSettings />}
      {tab === "models" && <ModelSettings />}
      {tab === "speech" && <SpeechSettings />}
      {tab === "email" && <EmailSettings />}
      {tab === "users" && <UserAdmin />}
    </>
  );

  const current = tabs.find((t) => t.id === tab);
  return (
    <div className="flex min-h-dvh w-full flex-col">
      <header className="bg-background/85 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto flex h-[calc(3.5rem+env(safe-area-inset-top))] w-full max-w-5xl items-center gap-3 px-4 pt-[env(safe-area-inset-top)]">
          <Link href="/" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <BrandMark compact className="sm:hidden" />
            <BrandMark className="hidden sm:inline-flex" />
          </Link>
          <span className="text-muted-foreground/50 text-lg font-light" aria-hidden>/</span>
          <span className="text-sm font-medium">Settings</span>
          <Button asChild variant="outline" size="sm" className="ml-auto">
            <Link href="/">
              <ArrowLeft />
              Back to chat
            </Link>
          </Button>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 pb-10 md:flex-row md:gap-10 md:py-10">
        <nav
          aria-label="Settings"
          className="bg-background sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 -mx-4 flex gap-1 overflow-x-auto border-b px-4 py-2 [scrollbar-width:none] md:static md:mx-0 md:w-48 md:shrink-0 md:flex-col md:self-start md:overflow-visible md:border-0 md:p-0"
        >
          {nav("you")}
          {isAdmin && (
            <>
              <div className="text-muted-foreground hidden px-2.5 pt-5 pb-1.5 text-xs font-medium md:block">Admin</div>
              <div className="bg-border mx-1 my-1.5 w-px shrink-0 md:hidden" />
              {nav("admin")}
            </>
          )}
        </nav>
        <main className="min-w-0 flex-1">
          {current && (
            <h1 className="mb-5 text-xl font-semibold tracking-tight">{current.label}</h1>
          )}
          <div className="grid gap-5">{isAdmin ? <SettingsProvider>{content}</SettingsProvider> : content}</div>
        </main>
      </div>
    </div>
  );
}
