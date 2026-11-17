import { connection } from "next/server";
import BetterAuthSignIn from "@/components/better-auth-signin";
import { getPublicAuthConfig } from "@/lib/public-config";

export default async function SignInPage() {
  // Settings can change at any time, so read them per request.
  await connection();
  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <BetterAuthSignIn config={await getPublicAuthConfig()} />
    </div>
  );
}
