import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { runUsage } from "@/db/schema";

const WINDOWS = { minute: 60_000, day: 86_400_000 } as const;
type WindowName = keyof typeof WINDOWS;

export type RunLimit = { window: WindowName; limit: number };
export type LimitedUser = { id: string; email: string; isAnonymous?: boolean | null };
export type WindowUsage = RunLimit & { used: number; resetAt: string };
export type Denial = RunLimit & { resetAt: string; message: string };

const DEFAULTS = {
  guest: { minute: 2, day: 3 },
  user: { minute: 5, day: 15 },
};

type Env = Record<string, string | undefined>;

/** The limits that apply to a user. Env vars override defaults; a value of 0 or less turns that window off. */
export function limitsFor(user: LimitedUser, env: Env = process.env): RunLimit[] {
  const exempt = (env.RUN_LIMIT_EXEMPT_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (!user.isAnonymous && exempt.includes(user.email.toLowerCase())) return [];

  const tier = user.isAnonymous ? "guest" : "user";
  return (Object.keys(WINDOWS) as WindowName[]).flatMap((window) => {
    const raw = env[`RUN_LIMIT_${tier.toUpperCase()}_PER_${window.toUpperCase()}`];
    const parsed = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
    const limit = Number.isFinite(parsed) ? Math.floor(parsed) : DEFAULTS[tier][window];
    return limit > 0 ? [{ window, limit }] : [];
  });
}

/** Fixed windows aligned to the epoch, so a day window starts at 00:00 UTC. */
export function windowStart(window: WindowName, now: Date): Date {
  const size = WINDOWS[window];
  return new Date(Math.floor(now.getTime() / size) * size);
}

export function resetAt(window: WindowName, now: Date): Date {
  return new Date(windowStart(window, now).getTime() + WINDOWS[window]);
}

export function denialMessage(limit: RunLimit, isGuest: boolean, now: Date, reset: Date): string {
  const minutes = Math.max(1, Math.ceil((reset.getTime() - now.getTime()) / 60_000));
  const [count, unit] = minutes < 60 ? [minutes, "minute"] : [Math.ceil(minutes / 60), "hour"];
  const wait = `${count} ${unit}${count === 1 ? "" : "s"}`;
  const scope = limit.window === "day" ? "today's" : "this minute's";
  const hint = isGuest && limit.window === "day" ? " Create a free account for a higher limit." : "";
  return `You've used ${scope} ${limit.limit} runs. Try again in ${wait}.${hint}`;
}

class LimitReached extends Error {
  constructor(readonly denial: Denial) {
    super(denial.message);
  }
}

/**
 * Counts one run against every window, or none if any window is full.
 * The conditional upsert makes the check and the increment one atomic step per window.
 */
export async function admitRun(user: LimitedUser, now = new Date()): Promise<Denial | null> {
  const limits = limitsFor(user);
  if (limits.length === 0) return null;
  try {
    await db.transaction(async (tx) => {
      for (const limit of limits) {
        const start = windowStart(limit.window, now);
        const admitted = await tx
          .insert(runUsage)
          .values({ userId: user.id, window: limit.window, windowStart: start, count: 1 })
          .onConflictDoUpdate({
            target: [runUsage.userId, runUsage.window, runUsage.windowStart],
            set: { count: sql`${runUsage.count} + 1` },
            setWhere: lt(runUsage.count, limit.limit),
          })
          .returning({ count: runUsage.count });
        if (admitted.length === 0) {
          const reset = resetAt(limit.window, now);
          throw new LimitReached({
            ...limit,
            resetAt: reset.toISOString(),
            message: denialMessage(limit, Boolean(user.isAnonymous), now, reset),
          });
        }
      }
      await tx
        .delete(runUsage)
        .where(and(eq(runUsage.userId, user.id), lt(runUsage.windowStart, new Date(now.getTime() - WINDOWS.day))));
    });
    return null;
  } catch (error) {
    if (error instanceof LimitReached) return error.denial;
    throw error;
  }
}

export async function getUsage(user: LimitedUser, now = new Date()): Promise<WindowUsage[]> {
  const rows = await db.select().from(runUsage).where(eq(runUsage.userId, user.id));
  return limitsFor(user).map((limit) => {
    const start = windowStart(limit.window, now).getTime();
    const row = rows.find((r) => r.window === limit.window && r.windowStart.getTime() === start);
    return { ...limit, used: row?.count ?? 0, resetAt: resetAt(limit.window, now).toISOString() };
  });
}
