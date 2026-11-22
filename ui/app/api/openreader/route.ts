import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/server";
import { connectionStatus, disconnect, OpenReaderError, saveHostVoices } from "@/lib/openreader";

/** The signed-in user's OpenReader connection: status, host voices, disconnect. */

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const status = await connectionStatus(session.user.id);
  return NextResponse.json(
    { ...status, canConnect: !session.user.isAnonymous },
    { headers: { "Cache-Control": "no-store" } },
  );
}

const voicesSchema = z.object({ hostVoices: z.array(z.string().trim().max(200)).max(2) });

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = voicesSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  try {
    await saveHostVoices(session.user.id, parsed.data.hostVoices);
  } catch (e) {
    if (e instanceof OpenReaderError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  return NextResponse.json({ hostVoices: parsed.data.hostVoices });
}

export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await disconnect(session.user.id);
  return new NextResponse(null, { status: 204 });
}
