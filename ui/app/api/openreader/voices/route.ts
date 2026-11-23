import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server";
import { listVoices, OpenReaderError } from "@/lib/openreader";

/** Voices of ?provider= and ?model= on OpenReader; without them, of the user's saved provider and model. */

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = req.nextUrl.searchParams;
  const provider = params.get("provider")?.trim().slice(0, 200) || undefined;
  const model = params.get("model")?.trim().slice(0, 256) || undefined;
  try {
    return NextResponse.json(await listVoices(session.user.id, { provider, model }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof OpenReaderError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}
