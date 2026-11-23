import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/server";
import { connectionStatus, disconnect, OpenReaderError, saveHosts } from "@/lib/openreader";

/** The signed-in user's OpenReader connection: status, podcast hosts' speech, disconnect. */

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const status = await connectionStatus(session.user.id);
  return NextResponse.json(
    { ...status, canConnect: !session.user.isAnonymous },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// Empty fields follow OpenReader's saved settings. Lengths match OpenReader's speech API.
const id = (max: number) => z.string().trim().max(max).optional();
const hostSchema = z.object({ provider: id(200), model: id(256), voice: id(512) }).strict();
const hostsSchema = z.object({ hosts: z.array(hostSchema).max(2) });

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = hostsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  try {
    await saveHosts(session.user.id, parsed.data.hosts);
  } catch (e) {
    if (e instanceof OpenReaderError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  return NextResponse.json({ hosts: parsed.data.hosts });
}

export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await disconnect(session.user.id);
  return new NextResponse(null, { status: 204 });
}
