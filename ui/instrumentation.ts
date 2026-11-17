// Runs once per server start: fill in seeded settings, then create the first
// admin if BOOTSTRAP_ADMIN_EMAIL is set. Failures are logged, not fatal, so a
// bad seed cannot take the site down.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { applySeed } = await import("./lib/settings/store");
  try {
    await applySeed();
  } catch (error) {
    console.error("Runtime seed failed:", error);
  }
}
