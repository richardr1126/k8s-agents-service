import { connection } from "next/server";
import BetterAuthSignUp from "@/components/better-auth-signup";
import { getPublicAuthConfig } from "@/lib/public-config";

export default async function SignUpPage() {
  await connection();
  const config = await getPublicAuthConfig();
  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <BetterAuthSignUp config={config} />
    </div>
  );
}
