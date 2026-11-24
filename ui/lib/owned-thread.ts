import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { threads } from "@/db/schema";
import { getSession } from "@/lib/server";
import { splitMode } from "@/lib/modes";

/** The signed-in user's thread and its backend agent, or the status to answer with. */
export async function ownedThread(context: { params: Promise<{ threadId: string }> }) {
  const session = await getSession();
  if (!session) return { status: 401 as const };
  const { threadId } = await context.params;
  const [row] = await db
    .select({ agentId: threads.agentId })
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, session.user.id)));
  if (!row) return { status: 404 as const };
  return { threadId, agent: splitMode(row.agentId).agentId };
}
