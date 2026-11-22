import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server";
import { getSpeechSettings, saveSpeechSettings, speechSettingsSchema } from "@/lib/tts/providers";
import { invalid, providerError } from "../_shared";

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  return NextResponse.json({ speech: await getSpeechSettings() });
}

export async function PUT(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;
  const parsed = speechSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error);
  try {
    return NextResponse.json({ speech: await saveSpeechSettings(parsed.data) });
  } catch (e) {
    return providerError(e);
  }
}
