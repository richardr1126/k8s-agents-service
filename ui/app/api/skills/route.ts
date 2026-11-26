import { NextResponse } from "next/server";
import { backendFetch, getSession } from "@/lib/server";

/** The backend's skill catalog: each command and how its card looks in the chat. */
export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const response = await backendFetch("/skills");
    if (!response.ok) throw new Error(`Backend request failed: ${response.status}`);
    return NextResponse.json(await response.json());
  } catch (error) {
    console.error("Skills API error:", error);
    return NextResponse.json({ error: "Failed to get skills" }, { status: 500 });
  }
}
