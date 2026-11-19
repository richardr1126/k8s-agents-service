"use client";

import { CheckIcon, ImagePlusIcon, Loader2, XIcon } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { AuthCard, AuthLink, Notice } from "@/components/auth-card";
import { showPrivacyPopup } from "@/components/privacy-popup";
import { Button } from "@/components/ui/button";
import { Field, PasswordInput } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signIn, signUp, useSession } from "@/lib/auth-client";
import type { PublicAuthConfig } from "@/lib/public-config";
import { cn } from "@/lib/utils";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PASSWORD_CHECKS = [
  { label: "8+ characters", test: (p: string) => p.length >= 8 },
  { label: "Uppercase", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Lowercase", test: (p: string) => /[a-z]/.test(p) },
  { label: "Number", test: (p: string) => /\d/.test(p) },
  { label: "Symbol", test: (p: string) => /[!@#$%^&*(),.?":{}|<>]/.test(p) },
];
/** How many of the checks a password needs. */
const MIN_STRENGTH = 3;
const STRENGTH = ["Very weak", "Weak", "Fair", "Good", "Strong"];

function passwordStrength(password: string) {
  const passed = PASSWORD_CHECKS.map((check) => check.test(password));
  return { passed, strength: passed.filter(Boolean).length };
}

/** A five-step bar and the checks it counts. */
function StrengthMeter({ password }: { password: string }) {
  const { passed, strength } = passwordStrength(password);
  const ok = strength >= MIN_STRENGTH;
  return (
    <div className="grid gap-2" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1">
          {PASSWORD_CHECKS.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i < strength ? (ok ? "bg-success" : strength === 2 ? "bg-warning" : "bg-destructive") : "bg-muted",
              )}
            />
          ))}
        </div>
        <span className={cn("w-16 text-right text-xs", ok ? "text-success" : "text-muted-foreground")}>
          {STRENGTH[Math.max(0, strength - 1)]}
        </span>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {PASSWORD_CHECKS.map((check, i) => (
          <li
            key={check.label}
            className={cn("flex items-center gap-1 text-xs", passed[i] ? "text-foreground" : "text-muted-foreground")}
          >
            <CheckIcon className={cn("size-3", passed[i] ? "text-success" : "opacity-30")} />
            {check.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Longest display name accepted. */
const MAX_NAME = 60;

type Errors = Partial<Record<"name" | "email" | "password" | "passwordConfirmation", string>>;

export default function SignUp({ config }: { config: PublicAuthConfig }) {
  // "verify": check your inbox; "pending": waiting for an admin.
  const [done, setDone] = useState<"verify" | "pending" | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Bumped on every pick or removal, so a read that finishes late is dropped. */
  const pickRef = useRef(0);
  /** The address the account was created with, for the confirmation screen. */
  const [submittedEmail, setSubmittedEmail] = useState("");
  const router = useRouter();
  const { refetch } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});

  /** An onChange that also clears that field's error. */
  const edit = (set: (value: string) => void, field: keyof Errors) => (e: React.ChangeEvent<HTMLInputElement>) => {
    set(e.target.value);
    setError(null);
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validate = () => {
    const next: Errors = {};
    const trimmed = name.trim();
    if (!trimmed) next.name = "Choose a display name.";
    else if (trimmed.length < 2) next.name = "At least 2 characters.";
    else if (trimmed.length > MAX_NAME) next.name = `At most ${MAX_NAME} characters.`;
    if (!email.trim()) next.email = "Enter your email.";
    else if (!EMAIL_PATTERN.test(email.trim())) next.email = "That doesn't look like an email address.";
    if (!password) next.password = "Choose a password.";
    else if (passwordStrength(password).strength < MIN_STRENGTH) next.password = "Too weak. Meet at least three of the checks.";
    if (!passwordConfirmation) next.passwordConfirmation = "Type the password again.";
    else if (password !== passwordConfirmation) next.passwordConfirmation = "The passwords don't match.";
    const found = Object.fromEntries(Object.entries(next).filter(([, v]) => v)) as Errors;
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const handleSignUp = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!validate()) return;
    setLoading(true);
    const address = email.trim();
    try {
      const result = await signUp.email({
        email: address,
        password,
        name: name.trim(),
        image: image ? await convertImageToBase64(image) : "",
      });

      if (result.error && config.signupPolicy === "approval" && result.error.status === 403) {
        // The account exists; signing in is refused until an admin approves it.
        setSubmittedEmail(address);
        setDone("pending");
      } else if (result.error) {
        const message = result.error.message || "Something went wrong.";
        const lower = message.toLowerCase();
        if (lower.includes("already exists") || lower.includes("email already") || lower.includes("user already")) {
          setError("An account with this email already exists. Sign in instead, or use another email.");
        } else if (lower.includes("invalid email")) {
          setError("That doesn't look like an email address.");
        } else if (lower.includes("password")) {
          setError("The password doesn't meet the requirements. Choose a stronger one.");
        } else {
          setError(message);
        }
      } else if (config.email) {
        setSubmittedEmail(address);
        setDone("verify");
      } else {
        // No email confirmation: sign straight in.
        const signInResult = await signIn.email({ email: address, password });
        if (signInResult.error) {
          toast.success("Account created. Sign in to continue.");
          router.push("/signin");
        } else {
          toast.success("Account created. Welcome!");
          await refetch();
          router.push("/");
        }
      }
    } catch (err) {
      console.error("Signup error:", err);
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const pick = ++pickRef.current;
    setImage(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      if (pick === pickRef.current) setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    pickRef.current++;
    setImage(null);
    setImagePreview(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const backToSignIn = <AuthLink href="/signin">Back to sign in</AuthLink>;
  if (config.signupPolicy === "closed") {
    return (
      <AuthCard title="Sign-ups are closed" footer={backToSignIn}>
        <p className="text-muted-foreground text-sm">
          New accounts aren&apos;t being created right now. Ask an admin for access.
        </p>
      </AuthCard>
    );
  }
  if (done) {
    return (
      <AuthCard title={done === "verify" ? "Check your email" : "Account created"} footer={backToSignIn}>
        <Notice kind="success">
          {done === "verify" ? (
            <>
              We sent a confirmation link to <strong>{submittedEmail}</strong>. It works for one hour.
              {config.signupPolicy === "approval" && " After you confirm, an admin still needs to approve the account."}
            </>
          ) : (
            "An admin needs to approve your account before you can sign in."
          )}
        </Notice>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      wide
      title="Create your account"
      description={
        config.signupPolicy === "approval"
          ? "An admin approves new accounts before they can sign in."
          : "Keep your conversations and pick them up anywhere."
      }
      footer={
        <>
          <p>
            Already have an account? <AuthLink href="/signin">Sign in</AuthLink>
          </p>
          <p>
            By creating an account you agree to the{" "}
            <button type="button" onClick={() => showPrivacyPopup()} className="text-foreground underline-offset-4 hover:underline">
              privacy policy
            </button>
            .
          </p>
        </>
      }
    >
      {error && <Notice kind="error">{error}</Notice>}
      <form onSubmit={handleSignUp} noValidate className="grid gap-4">
        <Field label="Display name" required hint={errors.name ? undefined : "How you appear in the app. You can change it later."} error={errors.name}>
          {(control) => (
            <Input
              {...control}
              autoComplete="nickname"
              placeholder="e.g. Alex"
              maxLength={MAX_NAME}
              value={name}
              onChange={edit(setName, "name")}
            />
          )}
        </Field>
        <Field label="Email" required error={errors.email}>
          {(control) => (
            <Input {...control} type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={edit(setEmail, "email")} />
          )}
        </Field>
        <Field label="Password" required error={errors.password}>
          {(control) => <PasswordInput {...control} autoComplete="new-password" value={password} onChange={edit(setPassword, "password")} />}
        </Field>
        {password && <StrengthMeter password={password} />}
        <Field
          label="Confirm password"
          required
          error={errors.passwordConfirmation}
          hint={passwordConfirmation && password === passwordConfirmation ? "Passwords match." : undefined}
        >
          {(control) => (
            <PasswordInput
              {...control}
              autoComplete="new-password"
              value={passwordConfirmation}
              onChange={edit(setPasswordConfirmation, "passwordConfirmation")}
            />
          )}
        </Field>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="bg-muted text-muted-foreground hover:text-foreground focus-visible:ring-ring relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full border outline-none focus-visible:ring-2"
            aria-label={imagePreview ? "Change profile picture" : "Add a profile picture"}
          >
            {imagePreview ? (
              <Image src={imagePreview} alt="" fill className="object-cover" />
            ) : (
              <ImagePlusIcon className="size-4" />
            )}
          </button>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">Profile picture</p>
            <p className="text-muted-foreground truncate text-xs">{image ? image.name : "Optional"}</p>
          </div>
          {imagePreview && (
            <Button type="button" variant="ghost" size="icon-sm" onClick={clearImage} aria-label="Remove profile picture">
              <XIcon />
            </Button>
          )}
          <input ref={fileRef} type="file" accept="image/*" onChange={handleImageChange} className="sr-only" tabIndex={-1} />
        </div>
        <Button type="submit" className="mt-1 w-full" disabled={loading}>
          {loading && <Loader2 className="animate-spin" />}
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}

async function convertImageToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
