import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ProviderError } from "@/lib/tts/providers";
import { speak } from "@/lib/tts/speak";

/**
 * Speech for the backend's podcast jobs. Authenticated with the same token the
 * UI uses for the backend (BACKEND_AUTH_TOKEN = the backend's AUTH_SECRET).
 */

export const maxDuration = 120;

const bodySchema = z.object({
  text: z.string().trim().min(1).max(4000),
  speaker: z.number().int().min(0).max(1).optional(),
  voice: z.string().trim().max(200).optional(),
  provider: z.string().trim().max(64).optional(),
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
  try {
    const audio = await speak(parsed.data, req.signal);
    return new NextResponse(new Uint8Array(audio), {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof ProviderError) return NextResponse.json({ error: e.message }, { status: e.status });
    const status = (e as { status?: number }).status;
    const message = e instanceof Error ? e.message : "Speech failed";
    console.error("Internal TTS failed:", message);
    return NextResponse.json({ error: message }, { status: status && status >= 400 && status < 600 ? status : 502 });
  }
}
