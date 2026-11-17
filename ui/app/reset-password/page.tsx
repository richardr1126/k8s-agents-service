"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { AuthCard, Notice } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const back = <Link href="/forgot-password" className="underline">Request a new link</Link>;
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
        <div className="grid gap-2">
          <Label htmlFor="password">New password</Label>
          <Input id="password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirm">Confirm new password</Label>
          <Input id="confirm" type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <Button type="submit" disabled={loading || password.length < 8}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Change password"}
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
