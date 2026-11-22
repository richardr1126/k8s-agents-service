import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/server";
import { connectionStatus, OpenReaderError, speak, SPEECH_MAX_CHARS } from "@/lib/openreader";

/** Read-aloud for chat replies, spoken by the user's OpenReader in Host 1's voice. */

export const maxDuration = 60;

const bodySchema = z.object({ text: z.string().trim().min(1).max(SPEECH_MAX_CHARS) });

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ available: false });
  const { connected } = await connectionStatus(session.user.id);
  return NextResponse.json({ available: connected }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  try {
    const audio = await speak(session.user.id, parsed.data.text, 0, req.signal);
    return new NextResponse(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof OpenReaderError) {
      const headers: Record<string, string> = e.retryAfter ? { "Retry-After": e.retryAfter } : {};
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status, headers });
    }
    console.error("Read-aloud failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Couldn't read this aloud." }, { status: 502 });
  }
}
