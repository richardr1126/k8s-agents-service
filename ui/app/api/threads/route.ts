import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { threads } from "@/db/schema";
import { getSession } from "@/lib/server";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await db
    .select({ id: threads.id, title: threads.title, agentId: threads.agentId, modelId: threads.modelId })
    .from(threads)
    .where(eq(threads.userId, session.user.id))
    .orderBy(desc(threads.updatedAt));
  return NextResponse.json(rows);
}
