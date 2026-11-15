import { NextResponse } from "next/server";
import { getUsage } from "@/lib/run-limits";
import { getSession } from "@/lib/server";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getUsage(session.user));
}
