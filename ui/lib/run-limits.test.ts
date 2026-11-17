import { describe, expect, it } from "vitest";
import { defaultSettings } from "./settings/definitions";
import { denialMessage, limitsFor, resetAt, windowStart } from "./run-limits";

const guest = { id: "g", isAnonymous: true };
const user = { id: "u", isAnonymous: false };
const defaults = defaultSettings().runLimits;

describe("limitsFor", () => {
  it("applies stricter defaults to guests", () => {
    expect(limitsFor(guest, defaults)).toEqual([
      { window: "minute", limit: 2 },
      { window: "day", limit: 3 },
    ]);
    expect(limitsFor(user, defaults)).toEqual([
      { window: "minute", limit: 5 },
      { window: "day", limit: 15 },
    ]);
  });

  it("turns a window off at 0", () => {
    const limits = { guest: { perMinute: 0, perDay: 10 }, user: { perMinute: 5, perDay: 0 } };
    expect(limitsFor(guest, limits)).toEqual([{ window: "day", limit: 10 }]);
    expect(limitsFor(user, limits)).toEqual([{ window: "minute", limit: 5 }]);
  });

  it("exempts admins and exempt accounts, but never guests", () => {
    expect(limitsFor({ ...user, isAdmin: true }, defaults)).toEqual([]);
    expect(limitsFor({ ...user, runLimitExempt: true }, defaults)).toEqual([]);
    expect(limitsFor({ ...guest, runLimitExempt: true }, defaults)).toHaveLength(2);
  });
});

describe("windows", () => {
  const now = new Date("2026-11-15T13:45:30.500Z");

  it("aligns day windows to UTC midnight and minute windows to the minute", () => {
    expect(windowStart("day", now).toISOString()).toBe("2026-11-15T00:00:00.000Z");
    expect(resetAt("day", now).toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(windowStart("minute", now).toISOString()).toBe("2026-11-15T13:45:00.000Z");
    expect(resetAt("minute", now).toISOString()).toBe("2026-11-15T13:46:00.000Z");
  });

  it("says when to retry and suggests an account to guests at the daily limit", () => {
    const day = { window: "day" as const, limit: 3 };
    expect(denialMessage(day, true, now, resetAt("day", now))).toBe(
      "You've used today's 3 runs. Try again in 11 hours. Create a free account for a higher limit.",
    );
    expect(denialMessage(day, false, now, resetAt("day", now))).toBe("You've used today's 3 runs. Try again in 11 hours.");
    const minute = { window: "minute" as const, limit: 2 };
    expect(denialMessage(minute, true, now, resetAt("minute", now))).toBe(
      "You've used this minute's 2 runs. Try again in 1 minute.",
    );
  });
});
