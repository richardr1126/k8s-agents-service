import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server";
import { deleteProvider, providerInputSchema, updateProvider } from "@/lib/tts/providers";
import { invalid, providerError } from "../../_shared";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { error } = await requireAdmin();
  if (error) return error;
  const parsed = providerInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error);
  try {
    return NextResponse.json({ provider: await updateProvider((await params).id, parsed.data) });
  } catch (e) {
    return providerError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { error } = await requireAdmin();
  if (error) return error;
  try {
    await deleteProvider((await params).id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return providerError(e);
  }
}
