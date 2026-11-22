import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server";
import { runProviderCheck } from "@/lib/tts/provider-check";
import { invalid, providerError } from "../_shared";
import { draftSchema, toDraft } from "../_draft";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;
  const parsed = draftSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error);
  try {
    return NextResponse.json({ items: await runProviderCheck(await toDraft(parsed.data), req.signal) });
  } catch (e) {
    return providerError(e);
  }
}
