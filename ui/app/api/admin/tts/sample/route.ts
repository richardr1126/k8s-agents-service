import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/server";
import { speak } from "@/lib/tts/speak";
import { providerError } from "../_shared";

export const maxDuration = 60;

const bodySchema = z.object({
  provider: z.string().trim().max(64).optional(),
  voice: z.string().trim().max(200).optional(),
  text: z.string().trim().min(1).max(300).optional(),
});

/** Speaks a short line with a provider and voice, for trying podcast voices. */
export async function POST(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { text = "Hi, welcome to the show. Today we're reading a new paper together.", ...rest } = parsed.data;
  try {
    const audio = await speak({ text, ...rest }, req.signal);
    return new NextResponse(new Uint8Array(audio), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (e) {
    try {
      return providerError(e);
    } catch {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Speech failed" }, { status: 502 });
    }
  }
}
