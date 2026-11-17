import { NextResponse } from "next/server";
import { backendFetch, requireAdmin } from "@/lib/server";
import type { ServiceInfo } from "@/lib/types";

/** Every model the agent service serves, before the admin's filter. */
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  const res = await backendFetch("/info");
  if (!res.ok) return NextResponse.json({ error: "The agent service did not answer" }, { status: 502 });
  const info = (await res.json()) as ServiceInfo;
  return NextResponse.json({ models: info.models, backendDefault: info.default_model });
}
