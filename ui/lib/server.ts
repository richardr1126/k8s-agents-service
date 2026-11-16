import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
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
