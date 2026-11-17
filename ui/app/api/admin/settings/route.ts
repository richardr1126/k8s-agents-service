import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server";
import { SETTING_KEYS, type SettingKey, defaultSettings } from "@/lib/settings/definitions";
import { getSettings, InvalidSetting, resetSetting, setSetting } from "@/lib/settings/store";

const isKey = (key: unknown): key is SettingKey => typeof key === "string" && (SETTING_KEYS as string[]).includes(key);

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  const { values, sources } = await getSettings();
  return NextResponse.json({ values, sources, defaults: defaultSettings() });
}

/** Body `{ key, value }`. */
export async function PUT(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;
  const body = (await req.json().catch(() => ({}))) as { key?: unknown; value?: unknown };
  if (!isKey(body.key)) return NextResponse.json({ error: "Unknown setting" }, { status: 400 });
  try {
    return NextResponse.json({ value: await setSetting(body.key, body.value) });
  } catch (e) {
    if (e instanceof InvalidSetting) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

/** `?key=` resets that setting to its default. */
export async function DELETE(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;
  const key = req.nextUrl.searchParams.get("key");
  if (!isKey(key)) return NextResponse.json({ error: "Unknown setting" }, { status: 400 });
  await resetSetting(key);
  return NextResponse.json({ value: defaultSettings()[key] });
}
