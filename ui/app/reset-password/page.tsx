"use client";

import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { AuthCard, AuthLink, Notice } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { Field, PasswordInput } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const back = <AuthLink href="/forgot-password">Request a new link</AuthLink>;
  if (!token || params.get("error")) {
    return (
      <AuthCard title="This link doesn't work" footer={back}>
        <Notice kind="error">The reset link is invalid or has expired. Links work once, for one hour.</Notice>
      </AuthCard>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) return setError("The passwords don't match.");
    setLoading(true);
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword: password, token: token! });
    setLoading(false);
    if (error) return setError(error.message ?? "Couldn't reset the password.");
    toast.success("Password changed. Sign in with the new one.");
    router.push("/signin");
  }

  return (
    <AuthCard title="Choose a new password" description="This signs you out everywhere else." footer={back}>
      <form onSubmit={submit} className="grid gap-4">
        {error && <Notice kind="error">{error}</Notice>}
        <Field label="New password" hint="At least 8 characters.">
          {(control) => (
            <PasswordInput {...control} autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
        </Field>
        <Field label="Confirm new password">
          {(control) => (
            <PasswordInput {...control} autoComplete="new-password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          )}
        </Field>
        <Button type="submit" disabled={loading || password.length < 8}>
          {loading && <Loader2 className="animate-spin" />}
          Change password
        </Button>
      </form>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
