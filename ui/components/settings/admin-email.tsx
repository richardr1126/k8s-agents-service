"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useDialogs } from "@/components/dialogs";
import { api, Badge, Row, Section, SourceBadge, Toggle } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Config = {
  enabled: boolean;
  senderName: string;
  senderEmail: string;
  replyTo: string | null;
  apiKeyLast4: string;
  source: "default" | "json-seed" | "admin";
};

const EMPTY = { enabled: false, senderName: "", senderEmail: "", replyTo: "", apiKey: "" };

export function EmailSettings() {
  const { confirm } = useDialogs();
  const [config, setConfig] = useState<Config | null | undefined>(undefined);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);

  const load = (c: Config | null) => {
    setConfig(c);
    setForm(c ? { enabled: c.enabled, senderName: c.senderName, senderEmail: c.senderEmail, replyTo: c.replyTo ?? "", apiKey: "" } : EMPTY);
  };

  useEffect(() => {
    api<{ config: Config | null }>("/api/admin/email").then((r) => load(r.config), (e: Error) => toast.error(e.message));
  }, []);

  if (config === undefined) return <Loader2 className="size-5 animate-spin text-muted-foreground" />;

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const needsKey = !config && !form.apiKey;
  const canSave = form.senderName.trim() && form.senderEmail.trim() && !needsKey;

  async function save() {
    setBusy("save");
    try {
      const body = {
        enabled: form.enabled,
        senderName: form.senderName.trim(),
        senderEmail: form.senderEmail.trim(),
        replyTo: form.replyTo.trim() || null,
        ...(form.apiKey && { apiKey: form.apiKey.trim() }),
      };
      const r = await api<{ config: Config }>("/api/admin/email", { method: "PUT", body: JSON.stringify(body) });
      load(r.config);
      toast.success(r.config.enabled ? "Account email is on" : "Email settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    try {
      const r = await api<{ sentTo: string }>("/api/admin/email/test", {
        method: "POST",
        body: JSON.stringify({ apiKey: form.apiKey.trim() || undefined, senderName: form.senderName.trim(), senderEmail: form.senderEmail.trim() }),
      });
      toast.success(`Test email sent to ${r.sentTo}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sending failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Remove email settings?",
      description: "Verification and password-reset emails stop, and the saved API key is deleted.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    setBusy("remove");
    try {
      await api("/api/admin/email", { method: "DELETE" });
      load(null);
      toast.success("Email settings removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section
      title="Account email"
      description={
        <>
          Sends confirmation, password-reset and email-change links through{" "}
          <a href="https://resend.com" target="_blank" rel="noreferrer" className="underline">Resend</a>. While it&apos;s on, new accounts must confirm
          their email before signing in.
        </>
      }
      actions={config ? <SourceBadge source={config.source} /> : <Badge>Not set up</Badge>}
    >
      <Row label="Send account emails" description="Turn off to keep the settings but stop sending.">
        <Toggle label="Send account emails" checked={form.enabled} onChange={(v) => set("enabled", v)} />
      </Row>
      <Row label="Sender name" description="Shown as who the email is from.">
        <Input className="sm:max-w-sm" value={form.senderName} placeholder="chat.richardr.dev" onChange={(e) => set("senderName", e.target.value)} aria-label="Sender name" />
      </Row>
      <Row label="Sender address" description="Must be on a domain you've verified in Resend.">
        <Input className="sm:max-w-sm" type="email" value={form.senderEmail} placeholder="accounts@mail.example.com" onChange={(e) => set("senderEmail", e.target.value)} aria-label="Sender address" />
      </Row>
      <Row label="Reply-to" description="Optional. Where replies go.">
        <Input className="sm:max-w-sm" type="email" value={form.replyTo} placeholder="you@example.com" onChange={(e) => set("replyTo", e.target.value)} aria-label="Reply-to address" />
      </Row>
      <Row
        label="Resend API key"
        description="Stored encrypted. A key with sending access to the sender's domain is enough."
        badge={config && <Badge>Saved, ends in {config.apiKeyLast4}</Badge>}
      >
        <Input
          className="font-mono text-xs sm:max-w-sm"
          type="password"
          autoComplete="off"
          value={form.apiKey}
          placeholder={config ? "Leave empty to keep the saved key" : "re_…"}
          onChange={(e) => set("apiKey", e.target.value)}
          aria-label="Resend API key"
        />
      </Row>
      <div className="flex flex-wrap justify-end gap-2 px-5 py-4">
        {config && (
          <Button variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10" disabled={busy !== null} onClick={remove}>
            {busy === "remove" ? <Loader2 className="size-4 animate-spin" /> : "Remove"}
          </Button>
        )}
        <Button variant="outline" disabled={busy !== null || !form.senderName.trim() || !form.senderEmail.trim() || needsKey} onClick={test}>
          {busy === "test" ? <Loader2 className="size-4 animate-spin" /> : "Send test email"}
        </Button>
        <Button disabled={busy !== null || !canSave} onClick={save}>
          {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : "Save"}
        </Button>
      </div>
    </Section>
  );
}
