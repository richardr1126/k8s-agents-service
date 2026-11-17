import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { getSettings } from "@/lib/settings/store";

/**
 * The signed-in session, or null. Also null for suspended or pending accounts,
 * and for guests once guest sessions are turned off, so a policy change takes
 * effect without waiting for sessions to expire.
 */
export async function getSession() {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  if (session.user.accessStatus && session.user.accessStatus !== "active") return null;
  if (session.user.isAnonymous && !(await getSettings()).values.allowGuests) return null;
  return session;
}

export type AppSession = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/** The session of an admin, or the 401/403 response to return instead. */
export async function requireAdmin(): Promise<{ session: AppSession; error?: never } | { session?: never; error: NextResponse }> {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!session.user.isAdmin) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { session };
}

/** Calls the agent service with the shared bearer token. */
export function backendFetch(path: string, init: RequestInit = {}) {
  const base = process.env.BACKEND_URL;
  if (!base) throw new Error("BACKEND_URL is not set");
  const token = process.env.BACKEND_AUTH_TOKEN;
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
}
