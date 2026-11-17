import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { account, adminSettings, user } from "@/db/schema";
import { INITIAL_ADMIN_MARKER } from "@/lib/settings/store";

const MIN_PASSWORD = 16;

async function bootstrapPassword(): Promise<string | null> {
  if (process.env.BOOTSTRAP_ADMIN_PASSWORD) return process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (process.env.BOOTSTRAP_ADMIN_PASSWORD_FILE) {
    return (await readFile(process.env.BOOTSTRAP_ADMIN_PASSWORD_FILE, "utf8")).trim();
  }
  return null;
}

/**
 * Makes the first admin from BOOTSTRAP_ADMIN_EMAIL, once per database.
 *
 * - An existing account with that email becomes an admin directly.
 * - Otherwise a new account is made with BOOTSTRAP_ADMIN_PASSWORD (or _FILE).
 *   It gets admin rights only after that password is changed, so the one in
 *   the env never works for admin pages.
 *
 * A marker row written in the same transaction makes later starts a no-op,
 * even if the env vars stay set or the admin is later removed.
 */
export async function ensureInitialAdmin(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) return;

  const result = await db.transaction(async (tx) => {
    // Serialize concurrent starts (several serverless instances at once).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bootstrap-admin'))`);
    const [marker] = await tx.select().from(adminSettings).where(eq(adminSettings.key, INITIAL_ADMIN_MARKER));
    if (marker) return null;

    const [existing] = await tx.select({ id: user.id }).from(user).where(eq(sql`lower(${user.email})`, email));
    let outcome: string;
    if (existing) {
      await tx
        .update(user)
        .set({ isAdmin: true, adminSource: "managed", accessStatus: "active", updatedAt: new Date() })
        .where(eq(user.id, existing.id));
      outcome = `existing account ${email} is now an admin`;
    } else {
      const password = await bootstrapPassword();
      if (!password || password.length < MIN_PASSWORD) {
        throw new Error(
          `BOOTSTRAP_ADMIN_PASSWORD (or _FILE) needs at least ${MIN_PASSWORD} characters to create ${email}`,
        );
      }
      const id = randomUUID();
      const now = new Date();
      await tx.insert(user).values({
        id,
        name: email.split("@")[0],
        email,
        emailVerified: true,
        isAdmin: false,
        adminSource: "bootstrap",
        accessStatus: "active",
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(account).values({
        id: randomUUID(),
        accountId: id,
        providerId: "credential",
        userId: id,
        password: await hashPassword(password),
        createdAt: now,
        updatedAt: now,
      });
      outcome = `created ${email}; sign in and change the password to get admin rights`;
    }
    await tx.insert(adminSettings).values({
      key: INITIAL_ADMIN_MARKER,
      value: { email, at: new Date().toISOString() },
      source: "system",
    });
    return outcome;
  });
  if (result) console.log(`Bootstrap admin: ${result}`);
}
