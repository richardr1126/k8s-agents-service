import { describe, expect, it } from "vitest";
import { denialMessage, limitsFor, resetAt, windowStart } from "./run-limits";

const guest = { id: "g", email: "temp@guest.local", isAnonymous: true };
const user = { id: "u", email: "Person@Example.com", isAnonymous: false };

describe("limitsFor", () => {
  it("applies stricter defaults to guests", () => {
    expect(limitsFor(guest, {})).toEqual([
      { window: "minute", limit: 2 },
      { window: "day", limit: 3 },
    ]);
    expect(limitsFor(user, {})).toEqual([
      { window: "minute", limit: 5 },
      { window: "day", limit: 15 },
    ]);
  });

  it("reads overrides from env and turns a window off at 0 or below", () => {
    const env = { RUN_LIMIT_GUEST_PER_DAY: "10", RUN_LIMIT_GUEST_PER_MINUTE: "0", RUN_LIMIT_USER_PER_DAY: "-1" };
    expect(limitsFor(guest, env)).toEqual([{ window: "day", limit: 10 }]);
    expect(limitsFor(user, env)).toEqual([{ window: "minute", limit: 5 }]);
  });

  it("ignores values that are not numbers", () => {
    expect(limitsFor(guest, { RUN_LIMIT_GUEST_PER_DAY: "lots", RUN_LIMIT_GUEST_PER_MINUTE: " " })).toEqual(
      limitsFor(guest, {}),
    );
  });

  it("exempts listed account emails, case-insensitively, but never guests", () => {
    const env = { RUN_LIMIT_EXEMPT_EMAILS: "other@example.com, person@example.com" };
    expect(limitsFor(user, env)).toEqual([]);
    expect(limitsFor({ ...guest, email: "person@example.com" }, env)).toHaveLength(2);
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
