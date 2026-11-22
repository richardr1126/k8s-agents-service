import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/server";
import { ProviderError } from "@/lib/tts/providers";
import { speak, speechAvailable } from "@/lib/tts/speak";

/** Read-aloud for chat replies, spoken with Host 1's voice from the speech settings. */

export const maxDuration = 60;

const bodySchema = z.object({ text: z.string().trim().min(1).max(2000) });

// Per-process and approximate, which is enough to stop one tab from running up a provider bill.
const WINDOW_MS = 10 * 60_000;
const MAX_PIECES = 120;
const recent = new Map<string, number[]>();

function allow(userId: string, now = Date.now()): boolean {
  const times = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= MAX_PIECES) {
    recent.set(userId, times);
    return false;
  }
  times.push(now);
  recent.set(userId, times);
  return true;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ available: false });
  return NextResponse.json({ available: await speechAvailable() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  if (!allow(session.user.id)) {
    return NextResponse.json({ error: "Reading aloud is paused for a few minutes; try again soon." }, { status: 429 });
  }
  try {
    const audio = await speak({ text: parsed.data.text, speaker: 0 }, req.signal);
    return new NextResponse(new Uint8Array(audio), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ProviderError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("Read-aloud failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Couldn't read this aloud." }, { status: 502 });
  }
}
