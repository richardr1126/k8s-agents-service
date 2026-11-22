import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server";
import { defaultBaseUrlForProviderType, defaultModelForProviderType } from "@/lib/tts/provider-policy";
import { resolveVoices } from "@/lib/tts/voice-resolution";
import { invalid, providerError } from "../_shared";
import { draftSchema, toDraft } from "../_draft";

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;
  const parsed = draftSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error);
  try {
    const draft = await toDraft(parsed.data);
    const result = await resolveVoices({
      provider: draft.providerType,
      model: draft.defaultModel || defaultModelForProviderType(draft.providerType),
      apiKey: draft.apiKey,
      baseUrl: draft.baseUrl || defaultBaseUrlForProviderType(draft.providerType),
    });
    return NextResponse.json(result);
  } catch (e) {
    return providerError(e);
  }
}
