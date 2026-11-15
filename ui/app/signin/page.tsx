import { connection } from "next/server";
import BetterAuthSignIn from "@/components/better-auth-signin";
import { githubSignIn } from "@/lib/auth";

export default async function SignInPage() {
  // Read the env at request time, not at build time.
  await connection();
  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <BetterAuthSignIn githubSignIn={githubSignIn} />
    </div>
  );
}
