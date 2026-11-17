import { NextRequest, NextResponse } from "next/server";
import { accountEmailSeedSchema } from "@/lib/settings/definitions";
import { requireAdmin } from "@/lib/server";
import { deleteAccountEmail, getAccountEmail, InvalidSetting, saveAccountEmail } from "@/lib/settings/store";

// Same fields as the seed, except the API key may be left out to keep the saved one.
const inputSchema = accountEmailSeedSchema.extend({ apiKey: accountEmailSeedSchema.shape.apiKey.optional() });

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  return NextResponse.json({ config: await getAccountEmail() });
}

export async function PUT(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;
  const parsed = inputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  }
  try {
    await saveAccountEmail(parsed.data);
  } catch (e) {
    if (e instanceof InvalidSetting) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  return NextResponse.json({ config: await getAccountEmail() });
}

export async function DELETE() {
  const { error } = await requireAdmin();
  if (error) return error;
  await deleteAccountEmail();
  return NextResponse.json({ config: null });
}
