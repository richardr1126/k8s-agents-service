import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { userOnboarding } from "@/db/schema";
import type { Onboarding } from "@/lib/queries";
import { getSession } from "@/lib/server";


async function read(userId: string): Promise<Onboarding> {
  const [row] = await db.select().from(userOnboarding).where(eq(userOnboarding.userId, userId)).limit(1);
  return { privacyAcceptedAt: row?.privacyAcceptedAt ? row.privacyAcceptedAt.getTime() : null };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await read(session.user.id));
}

/** `{ privacyAccepted: true }` records agreement to the current privacy policy. */
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { privacyAccepted?: unknown } | null;
  if (body?.privacyAccepted !== true) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  const now = new Date();
  await db
    .insert(userOnboarding)
    .values({ userId: session.user.id, privacyAcceptedAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: userOnboarding.userId, set: { privacyAcceptedAt: now, updatedAt: now } });
  return NextResponse.json(await read(session.user.id));
}
