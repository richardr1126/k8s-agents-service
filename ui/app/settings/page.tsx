import { redirect } from "next/navigation";
import { connection } from "next/server";
import { SettingsShell } from "@/components/settings/shell";
import { getPublicAuthConfig } from "@/lib/public-config";
import { getSession } from "@/lib/server";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await connection();
  const session = await getSession();
  if (!session) redirect("/signin");
  if (session.user.isAnonymous) redirect("/signup");
  const config = await getPublicAuthConfig();
  return <SettingsShell isAdmin={Boolean(session.user.isAdmin)} emailEnabled={config.email} />;
}
