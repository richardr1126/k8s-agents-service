import { NextResponse } from "next/server";
import { backendFetch, getSession } from "@/lib/server";
import { getSettings } from "@/lib/settings/store";
import type { ServiceInfo } from "@/lib/types";

export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const response = await backendFetch("/info");
    if (!response.ok) throw new Error(`Backend request failed: ${response.status}`);
    const info = (await response.json()) as ServiceInfo;
    // Admins choose which of the backend's models are offered and which one new chats start with.
    const { enabledModels, defaultModel } = (await getSettings()).values;
    const offered = enabledModels.length ? info.models.filter((m) => enabledModels.includes(m)) : info.models;
    const models = offered.length ? offered : info.models;
    const preferred = defaultModel ?? info.default_model;
    return NextResponse.json({ ...info, models, default_model: models.includes(preferred) ? preferred : models[0] });
  } catch (error) {
    console.error("Service info API error:", error);
    return NextResponse.json({ error: "Failed to get service info" }, { status: 500 });
  }
}
