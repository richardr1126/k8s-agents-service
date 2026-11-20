/**
 * Change both whenever the policy changes materially: everyone who agreed
 * before PRIVACY_POLICY_UPDATED_AT is asked to agree again.
 */
export const PRIVACY_POLICY_UPDATED_AT = Date.UTC(2026, 10, 1);
export const PRIVACY_POLICY_EFFECTIVE_DATE = "November 1, 2026";

/** Whether an acceptance (epoch ms, or null) covers the current policy. */
export function acceptsCurrentPolicy(acceptedAt: number | null | undefined): boolean {
  return typeof acceptedAt === "number" && Number.isFinite(acceptedAt) && acceptedAt >= PRIVACY_POLICY_UPDATED_AT;
}
