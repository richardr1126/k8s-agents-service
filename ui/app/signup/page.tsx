import { connection } from "next/server";
import BetterAuthSignUp from "@/components/better-auth-signup";
import { getPublicAuthConfig } from "@/lib/public-config";

export default async function SignUpPage() {
  await connection();
  const config = await getPublicAuthConfig();
  return (
    <BetterAuthSignUp config={config} />
  );
}
