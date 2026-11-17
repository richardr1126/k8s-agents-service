import { readFile } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { adminSettings } from "@/db/schema";
import { seal, unseal } from "@/lib/crypto";
import {
  SETTING_KEYS,
  type SettingKey,
  type Settings,
  defaultSettings,
  parseSetting,
  seedSchema,
} from "./definitions";

export type SettingSource = "default" | "json-seed" | "admin";
export type SettingsSnapshot = { values: Settings; sources: Record<SettingKey, SettingSource> };

/** Internal keys in admin_settings that are not admin settings. */
const ACCOUNT_EMAIL = "accountEmail";
export const INITIAL_ADMIN_MARKER = "initialAdminBootstrapped";
const KEY_PURPOSE = "resend-api-key";

/**
 * Current settings. Stored values that no longer fit their schema (after a
 * definition changes) fall back to the default rather than breaking the app.
 * Cached per request.
 */
export const getSettings = cache(async (): Promise<SettingsSnapshot> => {
  const rows = await db.select().from(adminSettings).where(inArray(adminSettings.key, SETTING_KEYS));
  const values = defaultSettings();
  const sources = Object.fromEntries(SETTING_KEYS.map((k) => [k, "default"])) as Record<SettingKey, SettingSource>;
  for (const row of rows) {
    const key = row.key as SettingKey;
    const value = parseSetting(key, row.value);
    if (value === undefined) {
      console.warn(`admin_settings.${key} does not fit its schema; using the default`);
      continue;
    }
    (values as Record<SettingKey, unknown>)[key] = value;
    sources[key] = row.source as SettingSource;
  }
  return { values, sources };
});

export class InvalidSetting extends Error {}

export async function setSetting<K extends SettingKey>(key: K, value: unknown): Promise<Settings[K]> {
  const parsed = parseSetting(key, value);
  if (parsed === undefined) throw new InvalidSetting(`Invalid value for ${key}`);
  const row = { key, value: parsed as object, source: "admin", updatedAt: new Date() };
  await db.insert(adminSettings).values(row).onConflictDoUpdate({ target: adminSettings.key, set: row });
  return parsed;
}

/** Removes the stored value, so the default applies again. */
export async function resetSetting(key: SettingKey): Promise<void> {
  await db.delete(adminSettings).where(eq(adminSettings.key, key));
}

// ---- Account email (Resend) ----

type StoredAccountEmail = {
  enabled: boolean;
  senderName: string;
  senderEmail: string;
  replyTo: string | null;
  apiKey: string; // sealed
  apiKeyLast4: string;
};

export type AccountEmailConfig = Omit<StoredAccountEmail, "apiKey"> & { source: SettingSource };
export type AccountEmailInput = Omit<StoredAccountEmail, "apiKey" | "apiKeyLast4"> & { apiKey?: string };

function storeEmail(input: AccountEmailInput & { apiKey: string }): StoredAccountEmail {
  return {
    enabled: input.enabled,
    senderName: input.senderName,
    senderEmail: input.senderEmail,
    replyTo: input.replyTo,
    apiKey: seal(input.apiKey, KEY_PURPOSE),
    apiKeyLast4: input.apiKey.slice(-4),
  };
}

async function readAccountEmail(): Promise<{ stored: StoredAccountEmail; source: SettingSource } | null> {
  const [row] = await db.select().from(adminSettings).where(eq(adminSettings.key, ACCOUNT_EMAIL));
  return row ? { stored: row.value as StoredAccountEmail, source: row.source as SettingSource } : null;
}

/** The saved account-email config without the API key, for the admin panel. */
export const getAccountEmail = cache(async (): Promise<AccountEmailConfig | null> => {
  const found = await readAccountEmail();
  if (!found) return null;
  const { apiKey: _, ...rest } = found.stored;
  return { ...rest, source: found.source };
});

/** Everything needed to send, or null when account email is off or unusable. */
export const getMailer = cache(async () => {
  const found = await readAccountEmail();
  if (!found?.stored.enabled) return null;
  try {
    const { stored } = found;
    return {
      apiKey: unseal(stored.apiKey, KEY_PURPOSE),
      from: `${stored.senderName} <${stored.senderEmail}>`,
      replyTo: stored.replyTo,
    };
  } catch (error) {
    console.error("Could not read the Resend API key; was BETTER_AUTH_SECRET changed?", error);
    return null;
  }
});

/** Saves the config. Without `apiKey`, the saved key is kept. */
export async function saveAccountEmail(input: AccountEmailInput): Promise<void> {
  let stored: StoredAccountEmail;
  if (input.apiKey) {
    stored = storeEmail({ ...input, apiKey: input.apiKey });
  } else {
    const found = await readAccountEmail();
    if (!found) throw new InvalidSetting("A Resend API key is required");
    stored = { ...found.stored, ...input, apiKey: found.stored.apiKey, apiKeyLast4: found.stored.apiKeyLast4 };
  }
  const row = { key: ACCOUNT_EMAIL, value: stored, source: "admin", updatedAt: new Date() };
  await db.insert(adminSettings).values(row).onConflictDoUpdate({ target: adminSettings.key, set: row });
}

export async function deleteAccountEmail(): Promise<void> {
  await db.delete(adminSettings).where(eq(adminSettings.key, ACCOUNT_EMAIL));
}

// ---- Seed ----

async function readSeedText(): Promise<string | null> {
  if (process.env.RUNTIME_SEED_JSON?.trim()) return process.env.RUNTIME_SEED_JSON;
  if (process.env.RUNTIME_SEED_JSON_PATH) return readFile(process.env.RUNTIME_SEED_JSON_PATH, "utf8");
  return null;
}

/**
 * Fills in settings from RUNTIME_SEED_JSON (or the file at RUNTIME_SEED_JSON_PATH).
 * Only keys with no stored value are written, so admin changes always win and
 * restarting with the same seed changes nothing.
 */
export async function applySeed(): Promise<void> {
  const text = await readSeedText();
  if (!text) return;
  const parsed = seedSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(`Invalid runtime seed:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  const seed = parsed.data;
  const rows: (typeof adminSettings.$inferInsert)[] = Object.entries(seed.settings ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({ key, value: value as object, source: "json-seed" }));
  if (seed.accountEmail) {
    rows.push({ key: ACCOUNT_EMAIL, value: storeEmail(seed.accountEmail), source: "json-seed" });
  }
  if (rows.length === 0) return;
  const written = await db
    .insert(adminSettings)
    .values(rows)
    .onConflictDoNothing({ target: adminSettings.key })
    .returning({ key: adminSettings.key });
  if (written.length) console.log(`Seeded admin settings: ${written.map((r) => r.key).join(", ")}`);
}
