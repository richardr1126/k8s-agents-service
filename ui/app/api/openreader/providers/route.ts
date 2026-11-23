import { NextResponse } from "next/server";
import { getSession } from "@/lib/server";
import { listProviders, OpenReaderError } from "@/lib/openreader";

/** The speech providers the user's OpenReader has enabled, with their models. */

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ providers: await listProviders(session.user.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof OpenReaderError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}
