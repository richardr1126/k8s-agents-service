import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { threads } from "@/db/schema";
import { backendFetch, getSession } from "@/lib/server";

type Context = { params: Promise<{ threadId: string }> };

async function ownedThread(threadId: string) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const where = and(eq(threads.id, threadId), eq(threads.userId, session.user.id));
  const [row] = await db.select({ id: threads.id }).from(threads).where(where);
  if (!row) return { error: NextResponse.json({ error: "Thread not found" }, { status: 404 }) };
  return { where };
}

/** The thread's messages from the backend, with sub-agent runs; converted in the browser. */
export async function GET(_req: Request, context: Context) {
  const { threadId } = await context.params;
  const owned = await ownedThread(threadId);
  if (owned.error) return owned.error;
  const upstream = await backendFetch("/history", { method: "POST", body: JSON.stringify({ thread_id: threadId }) });
  if (!upstream.ok) return NextResponse.json({ error: "Failed to load history" }, { status: 502 });
  return NextResponse.json(await upstream.json());
}

export async function PATCH(req: Request, context: Context) {
  const { threadId } = await context.params;
  const owned = await ownedThread(threadId);
  if (owned.error) return owned.error;
  const { title } = (await req.json()) as { title?: unknown };
  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  await db.update(threads).set({ title: title.trim().slice(0, 200) }).where(owned.where);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, context: Context) {
  const { threadId } = await context.params;
  const owned = await ownedThread(threadId);
  if (owned.error) return owned.error;
  const upstream = await backendFetch("/thread", { method: "DELETE", body: JSON.stringify({ thread_id: threadId }) });
  if (upstream.status === 409) {
    const body = (await upstream.json().catch(() => null)) as { detail?: string } | null;
    return NextResponse.json({ error: body?.detail ?? "This chat is busy; try again in a moment." }, { status: 409 });
  }
  if (!upstream.ok) return NextResponse.json({ error: "Failed to delete thread" }, { status: 502 });
  await db.delete(threads).where(owned.where);
  return NextResponse.json({ ok: true });
}
