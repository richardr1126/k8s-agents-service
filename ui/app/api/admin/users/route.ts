import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { threads, user } from "@/db/schema";
import { requireAdmin } from "@/lib/server";

/** Accounts (not guests), newest first, with `?q=` matching name or email and `?status=`. */
export async function GET(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const status = req.nextUrl.searchParams.get("status");
  const filters = [eq(user.isAnonymous, false)];
  if (q) filters.push(or(ilike(user.email, `%${q}%`), ilike(user.name, `%${q}%`))!);
  if (status === "active" || status === "pending" || status === "suspended") filters.push(eq(user.accessStatus, status));
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      isAdmin: user.isAdmin,
      adminSource: user.adminSource,
      accessStatus: user.accessStatus,
      runLimitExempt: user.runLimitExempt,
      createdAt: user.createdAt,
      threadCount: sql<number>`(select count(*)::int from ${threads} where ${threads.userId} = ${user.id})`,
    })
    .from(user)
    .where(and(...filters))
    .orderBy(desc(user.createdAt))
    .limit(200);
  const [{ guests }] = await db
    .select({ guests: sql<number>`count(*)::int` })
    .from(user)
    .where(eq(user.isAnonymous, true));
  return NextResponse.json({ users: rows, guests });
}
