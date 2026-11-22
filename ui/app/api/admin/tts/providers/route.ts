import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server";
import { createProvider, listProviders, providerInputSchema } from "@/lib/tts/providers";
import { invalid, providerError } from "../_shared";

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  return NextResponse.json({ providers: await listProviders() });
}

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;
  const parsed = providerInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error);
  try {
    return NextResponse.json({ provider: await createProvider(parsed.data) }, { status: 201 });
  } catch (e) {
    return providerError(e);
  }
}
