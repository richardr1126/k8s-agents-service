import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { threads } from "@/db/schema";
import { splitMode } from "@/lib/modes";
import { backendFetch, getSession } from "@/lib/server";

/** Reverts the thread to just before a user message; returns that message's text. */
export async function POST(req: Request, context: { params: Promise<{ threadId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { threadId } = await context.params;
  const [row] = await db
    .select({ agentId: threads.agentId })
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, session.user.id)));
  if (!row) return NextResponse.json({ error: "Thread not found" }, { status: 404 });

  const { messageId } = (await req.json().catch(() => ({}))) as { messageId?: unknown };
  if (typeof messageId !== "string" || !messageId) {
    return NextResponse.json({ error: "messageId is required" }, { status: 400 });
  }

  const upstream = await backendFetch("/thread/revert", {
    method: "POST",
    body: JSON.stringify({ thread_id: threadId, message_id: messageId, agent_id: splitMode(row.agentId).agentId }),
  });
  if (upstream.status === 404) return NextResponse.json({ error: "Message not found" }, { status: 404 });
  if (!upstream.ok) return NextResponse.json({ error: "Failed to revert" }, { status: 502 });
  await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, threadId));
  return NextResponse.json(await upstream.json());
}
