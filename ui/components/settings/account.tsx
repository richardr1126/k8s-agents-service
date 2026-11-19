"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useDialogs } from "@/components/dialogs";
import { Badge, Row, Section } from "@/components/settings/parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient, useSession } from "@/lib/auth-client";

function Spinner() {
  return <Loader2 className="size-4 animate-spin" />;
}

export function AccountSettings({ emailEnabled }: { emailEnabled: boolean }) {
  const { data: session, refetch } = useSession();
  const user = session?.user;
  const [providers, setProviders] = useState<string[] | null>(null);

  useEffect(() => {
    authClient.listAccounts().then(({ data }) => setProviders(data?.map((a) => a.providerId) ?? []));
  }, []);

  if (!user) return null;
  const hasPassword = providers?.includes("credential") ?? false;

  return (
    <div className="grid gap-6">
      <Section
        title="Profile"
        description="How you appear in this app."
        actions={
          <div className="flex gap-1.5">
            {user.isAdmin && <Badge tone="accent">Admin</Badge>}
            {user.adminSource === "bootstrap" && <Badge tone="warn">Change your password to get admin rights</Badge>}
          </div>
        }
      >
        <NameRow name={user.name} onSaved={refetch} />
        <EmailRow email={user.email} verified={user.emailVerified} emailEnabled={emailEnabled} />
        <Row label="Sign-in methods" description="Ways you can sign in to this account.">
          <div className="flex flex-wrap gap-1.5 sm:justify-end">
            {providers === null ? (
              <Spinner />
            ) : (
              providers.map((p) => <Badge key={p}>{p === "credential" ? "Email and password" : p === "github" ? "GitHub" : p}</Badge>)
            )}
          </div>
        </Row>
      </Section>

      {hasPassword && <PasswordSection onChanged={refetch} />}
      {providers !== null && !hasPassword && (
        <Section title="Password" description="This account signs in with GitHub and has no password.">
          <Row
            label="Add a password"
            description={emailEnabled ? "Use “Forgot your password?” on the sign-in page to set one by email." : "Password sign-in can be added once account email is set up."}
          >
            {null}
          </Row>
        </Section>
      )}
      <DangerSection hasPassword={hasPassword} />
    </div>
  );
}

function NameRow({ name, onSaved }: { name: string; onSaved: () => void }) {
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [synced, setSynced] = useState(name);
  if (synced !== name) {
    setSynced(name);
    setValue(name);
  }
  const dirty = value.trim() !== name && value.trim().length > 0;
  async function save() {
    setSaving(true);
    const { error } = await authClient.updateUser({ name: value.trim() });
    setSaving(false);
    if (error) return toast.error(error.message ?? "Couldn't save your name");
    toast.success("Name saved");
    onSaved();
  }
  return (
    <Row label="Display name">
      <form
        className="flex w-full gap-2 sm:max-w-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) save();
        }}
      >
        <Input value={value} onChange={(e) => setValue(e.target.value)} maxLength={100} aria-label="Display name" />
        <Button type="submit" variant="outline" disabled={!dirty || saving}>
          {saving ? <Spinner /> : "Save"}
        </Button>
      </form>
    </Row>
  );
}

function EmailRow({ email, verified, emailEnabled }: { email: string; verified: boolean; emailEnabled: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function change() {
    setBusy(true);
    const { error } = await authClient.changeEmail({ newEmail: value.trim(), callbackURL: "/settings" });
    setBusy(false);
    if (error) return toast.error(error.message ?? "Couldn't change your email");
    toast.success(verified ? `Confirm the change from the link sent to ${email}` : `Confirm ${value.trim()} from the link we sent it`);
    setEditing(false);
  }

  async function resend() {
    setBusy(true);
    const { error } = await authClient.sendVerificationEmail({ email, callbackURL: "/settings" });
    setBusy(false);
    if (error) toast.error(error.message ?? "Couldn't send the email");
    else toast.success(`Confirmation link sent to ${email}`);
  }

  return (
    <Row
      label="Email"
      badge={verified ? <Badge tone="ok">Confirmed</Badge> : <Badge tone="warn">Not confirmed</Badge>}
      description={emailEnabled ? undefined : "Changing your email needs account email, which isn't set up."}
    >
      {editing ? (
        <form
          className="flex w-full gap-2 sm:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            change();
          }}
        >
          <Input type="email" required autoFocus placeholder="new@example.com" value={value} onChange={(e) => setValue(e.target.value)} aria-label="New email" />
          <Button type="submit" disabled={busy || !value.trim()}>{busy ? <Spinner /> : "Send link"}</Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <span className="break-all text-sm">{email}</span>
          {emailEnabled && !verified && (
            <Button size="sm" variant="outline" disabled={busy} onClick={resend}>Resend link</Button>
          )}
          {emailEnabled && (
            <Button size="sm" variant="outline" onClick={() => { setValue(""); setEditing(true); }}>Change</Button>
          )}
        </div>
      )}
    </Row>
  );
}

function PasswordSection({ onChanged }: { onChanged: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const mismatch = confirm.length > 0 && next !== confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) return;
    setSaving(true);
    const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
    setSaving(false);
    if (error) return toast.error(error.code === "INVALID_PASSWORD" ? "Your current password is wrong" : (error.message ?? "Couldn't change the password"));
    toast.success("Password changed. Other devices were signed out.");
    setCurrent("");
    setNext("");
    setConfirm("");
    onChanged();
  }

  return (
    <Section title="Password" description="Changing it signs you out on your other devices.">
      <form onSubmit={submit} className="grid gap-3 px-5 py-4 sm:max-w-md">
        <Input type="password" autoComplete="current-password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} aria-label="Current password" required />
        <Input type="password" autoComplete="new-password" placeholder="New password (8+ characters)" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} aria-label="New password" required />
        <Input type="password" autoComplete="new-password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Confirm new password" aria-invalid={mismatch} required />
        {mismatch && <p className="text-xs text-destructive">The passwords don&apos;t match.</p>}
        <div>
          <Button type="submit" disabled={saving || !current || next.length < 8 || next !== confirm}>
            {saving ? <Spinner /> : "Change password"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function DangerSection({ hasPassword }: { hasPassword: boolean }) {
  const { confirm, prompt } = useDialogs();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    let password: string | undefined;
    if (hasPassword) {
      const entered = await prompt({
        title: "Delete your account?",
        description: "This deletes your account and every conversation, and can't be undone. Enter your password to confirm.",
        confirmLabel: "Delete account",
        destructive: true,
        inputType: "password",
        placeholder: "Password",
      });
      if (!entered) return;
      password = entered;
    } else if (
      !(await confirm({
        title: "Delete your account?",
        description: "This deletes your account and every conversation, and can't be undone.",
        confirmLabel: "Delete account",
        destructive: true,
      }))
    ) {
      return;
    }
    setBusy(true);
    const { error } = await authClient.deleteUser({ password, callbackURL: "/signin" });
    setBusy(false);
    if (error) {
      return toast.error(error.code === "SESSION_EXPIRED" ? "Sign in again, then delete the account." : (error.message ?? "Couldn't delete the account"));
    }
    toast.success("Account deleted");
    router.replace("/signin");
  }

  return (
    <Section title="Delete account">
      <Row label="Delete your account" description="Removes your account and all your conversations for good.">
        <Button variant="destructive" disabled={busy} onClick={remove}>
          {busy ? <Spinner /> : "Delete account"}
        </Button>
      </Row>
    </Section>
  );
}
