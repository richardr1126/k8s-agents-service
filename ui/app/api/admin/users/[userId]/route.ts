import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { session as sessionTable, user } from "@/db/schema";
import { requireAdmin } from "@/lib/server";
import { deleteBackendThreads } from "@/lib/user-data";

const patchSchema = z
  .object({
    isAdmin: z.boolean(),
    accessStatus: z.enum(["active", "pending", "suspended"]),
    runLimitExempt: z.boolean(),
  })
  .partial()
  .strict();

/** Changes a user's role, access or run-limit exemption. Admins can't demote or lock out themselves. */
export async function PATCH(req: NextRequest, context: { params: Promise<{ userId: string }> }) {
  const { session, error } = await requireAdmin();
  if (error) return error;
  const { userId } = await context.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid change" }, { status: 400 });
  const change = parsed.data;
  if (userId === session.user.id && (change.isAdmin === false || (change.accessStatus && change.accessStatus !== "active"))) {
    return NextResponse.json({ error: "You can't remove your own admin access" }, { status: 400 });
  }
  const set: Partial<typeof user.$inferInsert> = { ...change, updatedAt: new Date() };
  if (change.isAdmin !== undefined) set.adminSource = change.isAdmin ? "managed" : null;
  const [updated] = await db.update(user).set(set).where(eq(user.id, userId)).returning({ id: user.id });
  if (!updated) return NextResponse.json({ error: "User not found" }, { status: 404 });
  // A suspended account is signed out everywhere right away.
  if (change.accessStatus === "suspended") await db.delete(sessionTable).where(eq(sessionTable.userId, userId));
  return NextResponse.json({ ok: true });
}

/** Deletes an account with its chats in this app. Admins can't delete themselves here. */
export async function DELETE(_req: NextRequest, context: { params: Promise<{ userId: string }> }) {
  const { session, error } = await requireAdmin();
  if (error) return error;
  const { userId } = await context.params;
  if (userId === session.user.id) return NextResponse.json({ error: "Delete your own account from Account settings" }, { status: 400 });
  try {
    await deleteBackendThreads(userId);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't delete conversations" }, { status: 502 });
  }
  const [deleted] = await db.delete(user).where(eq(user.id, userId)).returning({ id: user.id });
  if (!deleted) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
