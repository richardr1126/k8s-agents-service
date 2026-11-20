"use client";

import { Loader2, UserIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthCard, AuthDivider, AuthLink, Notice } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, PasswordInput } from "@/components/ui/field";
import { GitHubIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, useSession } from "@/lib/auth-client";
import type { PublicAuthConfig } from "@/lib/public-config";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Pending = "email" | "github" | "guest" | null;

export default function SignIn({ config }: { config: PublicAuthConfig }) {
  const { githubSignIn, allowGuests, signupPolicy } = config;
  const router = useRouter();
  // Load the new session before leaving, or the chat page would see none and send us back.
  const { refetch } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  const validate = () => {
    const errors: typeof fieldErrors = {};
    if (!email.trim()) errors.email = "Enter your email.";
    else if (!EMAIL_PATTERN.test(email.trim())) errors.email = "That doesn't look like an email address.";
    if (!password) errors.password = "Enter your password.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const enter = async () => {
    await refetch();
    router.push("/");
  };

  const signInWithEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!validate()) return;
    setPending("email");
    try {
      const result = await signIn.email({ email: email.trim(), password, rememberMe });
      if (!result.error) return await enter();
      const { code, message } = result.error;
      if (code === "INVALID_EMAIL_OR_PASSWORD") setError("Wrong email or password.");
      else if (code === "EMAIL_NOT_VERIFIED") setError(`Confirm your email first. We sent a new link to ${email.trim()}.`);
      // Approval and suspension messages come from the server as they should be shown.
      else setError(message || "Couldn't sign in. Please try again.");
    } catch (err) {
      console.error("Sign in error:", err);
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  };

  const signInWithGitHub = () =>
    signIn.social(
      { provider: "github", callbackURL: "/" },
      { onRequest: () => setPending("github"), onResponse: () => setPending(null) },
    );

  const continueAsGuest = async () => {
    setPending("guest");
    setError(null);
    try {
      const result = await signIn.anonymous();
      if (result.error) throw new Error(result.error.message);
      await enter();
    } catch (e) {
      console.error("Anonymous sign-in failed:", e);
      setError(e instanceof Error && e.message ? e.message : "Couldn't continue as a guest. Try another way.");
    } finally {
      setPending(null);
    }
  };

  const busy = pending !== null;
  const spinner = <Loader2 className="animate-spin" />;
  const alternatives = githubSignIn || allowGuests;

  return (
    <AuthCard
      title="Welcome back"
      description={allowGuests ? "Sign in to your account, or try it out as a guest." : "Sign in to your account."}
      footer={
        <>
          {signupPolicy !== "closed" && (
            <p>
              Don&apos;t have an account? <AuthLink href="/signup">Sign up</AuthLink>
            </p>
          )}
          <p>
            By continuing you agree to the{" "}
            <a href="/privacy" target="_blank" rel="noreferrer" className="text-foreground underline-offset-4 hover:underline">privacy policy</a>
            .
          </p>
        </>
      }
    >
      {error && <Notice kind="error">{error}</Notice>}

      {alternatives && (
        <div className="grid gap-2">
          {githubSignIn && (
            <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={signInWithGitHub}>
              {pending === "github" ? spinner : <GitHubIcon />}
              Continue with GitHub
            </Button>
          )}
          {allowGuests && (
            <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={continueAsGuest}>
              {pending === "guest" ? spinner : <UserIcon />}
              Continue as guest
            </Button>
          )}
        </div>
      )}
      {alternatives && <AuthDivider>or with email</AuthDivider>}

      <form onSubmit={signInWithEmail} noValidate className="grid gap-4">
        <Field label="Email" error={fieldErrors.email}>
          {(control) => (
            <Input
              {...control}
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
                setFieldErrors((prev) => ({ ...prev, email: undefined }));
              }}
            />
          )}
        </Field>
        <Field
          label="Password"
          error={fieldErrors.password}
          action={
            config.email && (
              <AuthLink href="/forgot-password" className="text-muted-foreground hover:text-foreground text-xs font-normal">
                Forgot password?
              </AuthLink>
            )
          }
        >
          {(control) => (
            <PasswordInput
              {...control}
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
                setFieldErrors((prev) => ({ ...prev, password: undefined }));
              }}
            />
          )}
        </Field>
        <div className="flex items-center gap-2">
          <Checkbox id="remember" checked={rememberMe} onCheckedChange={(checked) => setRememberMe(Boolean(checked))} />
          <Label htmlFor="remember" className="text-muted-foreground text-[13px] font-normal">
            Keep me signed in
          </Label>
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {pending === "email" && spinner}
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
