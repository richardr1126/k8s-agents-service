import { NextResponse } from "next/server";
import { getSession } from "@/lib/server";
import { listVoices, OpenReaderError } from "@/lib/openreader";

/** The voices of the user's saved speech provider and model on OpenReader. */

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await listVoices(session.user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof OpenReaderError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}
