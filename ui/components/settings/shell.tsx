"use client";

import { ArrowLeft, Gauge, Mail, Shield, Sparkles, User, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountSettings } from "@/components/settings/account";
import { AccessSettings, LimitSettings, ModelSettings, SettingsProvider } from "@/components/settings/admin-settings";
import { EmailSettings } from "@/components/settings/admin-email";
import { UserAdmin } from "@/components/settings/admin-users";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "account", label: "Account", icon: User, admin: false },
  { id: "access", label: "Access", icon: Shield, admin: true },
  { id: "limits", label: "Run limits", icon: Gauge, admin: true },
  { id: "models", label: "Models", icon: Sparkles, admin: true },
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
            "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
            tab === t.id ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
        >
          <t.icon className="size-4" />
          {t.label}
        </button>
      ));

  const content = (
    <>
      {tab === "account" && <AccountSettings emailEnabled={emailEnabled} />}
      {tab === "access" && <AccessSettings />}
      {tab === "limits" && <LimitSettings />}
      {tab === "models" && <ModelSettings />}
      {tab === "email" && <EmailSettings />}
      {tab === "users" && <UserAdmin />}
    </>
  );

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 py-6 md:py-10">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/" className="inline-flex size-9 items-center justify-center rounded-full border hover:bg-muted" aria-label="Back to chat">
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-xl font-semibold">Settings</h1>
      </div>
      <div className="flex flex-col gap-6 md:flex-row">
        <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:w-48 md:shrink-0 md:flex-col md:overflow-visible md:px-0">
          {nav("you")}
          {isAdmin && (
            <>
              <div className="hidden px-3 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:block">Admin</div>
              <div className="mx-1 w-px shrink-0 bg-border md:hidden" />
              {nav("admin")}
            </>
          )}
        </nav>
        <main className="min-w-0 flex-1">
          {isAdmin ? <SettingsProvider>{content}</SettingsProvider> : content}
        </main>
      </div>
    </div>
  );
}
