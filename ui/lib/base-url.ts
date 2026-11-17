/** The public origin. BASE_URL wins; on Vercel the production domain is the fallback. */
export function baseUrl(env: Record<string, string | undefined> = process.env): string {
  if (env.BASE_URL) return env.BASE_URL.replace(/\/$/, "");
  if (env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return "http://localhost:3000";
}
