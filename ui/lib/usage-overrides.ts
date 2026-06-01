export const UNLIMITED_USAGE_OVERRIDE_USER_ID = "user-1758242115818-8a4asz";
export const UNLIMITED_USAGE_OVERRIDE_EMAIL = "me@richardr.dev";
export const UNLIMITED_RATE_LIMIT = Number.MAX_SAFE_INTEGER;

interface UsageOverrideUser {
  id?: string | null;
  email?: string | null;
}

function normalizeEmail(email?: string | null): string {
  return (email ?? "").trim().toLowerCase();
}

export function hasUnlimitedUsageOverride(user: UsageOverrideUser): boolean {
  const idMatch = user.id === UNLIMITED_USAGE_OVERRIDE_USER_ID;
  const emailMatch = normalizeEmail(user.email) === UNLIMITED_USAGE_OVERRIDE_EMAIL;
  return idMatch || emailMatch;
}

export function isUnlimitedRateLimit(limit: number): boolean {
  return limit === UNLIMITED_RATE_LIMIT;
}
