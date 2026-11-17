import Link from "next/link";
import { connection } from "next/server";
import { AuthCard } from "@/components/auth-card";
import { getPublicAuthConfig } from "@/lib/public-config";
import { ForgotPasswordForm } from "./form";

export default async function ForgotPasswordPage() {
  await connection();
  if (!(await getPublicAuthConfig()).email) {
    return (
      <AuthCard
        title="Reset your password"
        description="Password reset by email isn't set up on this site. Ask an admin to reset it for you."
        footer={<Link href="/signin" className="underline">Back to sign in</Link>}
      >
        {null}
      </AuthCard>
    );
  }
  return <ForgotPasswordForm />;
}
