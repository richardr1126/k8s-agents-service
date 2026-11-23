import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { OpenReaderError, speak, SPEECH_MAX_CHARS } from "@/lib/openreader";

/**
 * Speech for the backend's podcast jobs, through the user's OpenReader connection.
 * Authenticated with the same token the UI uses for the backend
 * (BACKEND_AUTH_TOKEN = the backend's AUTH_SECRET).
 */

export const maxDuration = 120;

const bodySchema = z.object({
  text: z.string().trim().min(1).max(SPEECH_MAX_CHARS),
  speaker: z.number().int().min(0).max(1).optional(),
  user_id: z.string().min(1).max(200),
});

function authorized(req: NextRequest): boolean {
  const token = process.env.BACKEND_AUTH_TOKEN;
  if (!token) return process.env.NODE_ENV !== "production"; // local dev runs without one
  const given = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  const { text, speaker = 0, user_id } = parsed.data;
  try {
    const audio = await speak(user_id, text, speaker, req.signal);
    return new NextResponse(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof OpenReaderError) {
      const headers: Record<string, string> = e.retryAfter ? { "Retry-After": e.retryAfter } : {};
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status, headers });
    }
    console.error("Internal TTS failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Speech failed" }, { status: 502 });
  }
}
