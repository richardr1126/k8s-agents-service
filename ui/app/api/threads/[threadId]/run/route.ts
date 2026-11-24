import { NextResponse } from "next/server";
import { backendFetch } from "@/lib/server";
import { ownedThread } from "@/lib/owned-thread";

type Context = { params: Promise<{ threadId: string }> };

/** Whether the conversation has a reply running, and the message it started from. */
export async function GET(_req: Request, context: Context) {
  const owned = await ownedThread(context);
  if ("status" in owned) return NextResponse.json({ error: "Thread not found" }, { status: owned.status });
  const res = await backendFetch(`/ag-ui/${encodeURIComponent(owned.threadId)}/live`, { cache: "no-store" });
  if (!res.ok) return NextResponse.json({ error: "Couldn't check the reply" }, { status: 502 });
  return NextResponse.json(await res.json());
}

/** Stops the running reply: the stop button. A dropped connection leaves it running. */
export async function DELETE(_req: Request, context: Context) {
  const owned = await ownedThread(context);
  if ("status" in owned) return NextResponse.json({ error: "Thread not found" }, { status: owned.status });
  const res = await backendFetch(`/ag-ui/${encodeURIComponent(owned.threadId)}/stop`, { method: "POST" });
  if (!res.ok) return NextResponse.json({ error: "Couldn't stop the reply" }, { status: 502 });
  return NextResponse.json(await res.json());
}
