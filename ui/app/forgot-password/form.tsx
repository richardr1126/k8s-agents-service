"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AuthCard, Notice } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const address = email.trim();
    const { error } = await authClient.requestPasswordReset({ email: address, redirectTo: "/reset-password" });
    setLoading(false);
    if (error) setError(error.message ?? "Couldn't send the email. Try again in a minute.");
    else setSentTo(address);
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your account's email and we'll send you a link to choose a new password."
      footer={<Link href="/signin" className="underline">Back to sign in</Link>}
    >
      {sentTo ? (
        <Notice kind="success">
          If an account uses <strong>{sentTo}</strong>, a reset link is on its way. It works for one hour.
        </Notice>
      ) : (
        <form onSubmit={submit} className="grid gap-4">
          {error && <Notice kind="error">{error}</Notice>}
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" required disabled={loading} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Button type="submit" disabled={loading || !email.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
