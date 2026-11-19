import { connection } from "next/server";
import BetterAuthSignIn from "@/components/better-auth-signin";
import { getPublicAuthConfig } from "@/lib/public-config";

export default async function SignInPage() {
  // Settings can change at any time, so read them per request.
  await connection();
  return (
    <BetterAuthSignIn config={await getPublicAuthConfig()} />
  );
}
