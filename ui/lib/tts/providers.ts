import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { adminSettings } from "@/db/schema";
import { seal, unseal } from "@/lib/crypto";
import { normalizeOpenRouterOptions } from "./openrouter";
import type { TtsProviderId } from "./provider-catalog";

/**
 * Speech providers the admin configures, stored as one admin_settings row
 * with each API key sealed. Same model as OpenReader's admin providers:
 * a slug, a built-in provider type, and defaults for model and instructions.
 */

/** Provider types offered here. Kokoro-local needs OpenReader's compute worker, so it is left out. */
export const PROVIDER_TYPES = [
  "custom-openai",
  "openai",
  "openrouter",
  "fish-audio",
  "google-ai-studio",
  "replicate",
] as const satisfies readonly TtsProviderId[];
export type ProviderType = (typeof PROVIDER_TYPES)[number];

const ROW_KEY = "ttsProviders";
const KEY_PURPOSE = "tts-provider-key";
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/;

export const providerInputSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SLUG, "lowercase letters, digits and hyphens, 1-64 characters")
    .refine((s) => !(PROVIDER_TYPES as readonly string[]).includes(s), "collides with a provider type"),
  displayName: z.string().trim().min(1).max(80),
  providerType: z.enum(PROVIDER_TYPES),
  baseUrl: z.string().trim().url().max(500).nullable().optional(),
  apiKey: z.string().trim().max(500).optional(),
  defaultModel: z.string().trim().max(200).nullable().optional(),
  defaultVoice: z.string().trim().max(200).nullable().optional(),
  defaultInstructions: z.string().trim().max(2000).nullable().optional(),
  defaultModelOptions: z.string().trim().max(16_384).nullable().optional(),
  enabled: z.boolean().optional(),
});
export type ProviderInput = z.infer<typeof providerInputSchema>;

type StoredProvider = {
  id: string;
  slug: string;
  displayName: string;
  providerType: ProviderType;
  baseUrl: string | null;
  apiKey: string | null; // sealed
  apiKeyLast4: string | null;
  defaultModel: string | null;
  defaultVoice: string | null;
  defaultInstructions: string | null;
  defaultModelOptions: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

/** What the admin panel sees: everything but the key. */
export type MaskedProvider = Omit<StoredProvider, "apiKey"> & { hasApiKey: boolean };
/** What speech synthesis needs. */
export type ResolvedProvider = Omit<StoredProvider, "apiKey" | "apiKeyLast4"> & { apiKey: string };

export class ProviderError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

async function readAll(): Promise<StoredProvider[]> {
  const [row] = await db.select().from(adminSettings).where(eq(adminSettings.key, ROW_KEY));
  return Array.isArray(row?.value) ? (row.value as StoredProvider[]) : [];
}

async function writeAll(providers: StoredProvider[]): Promise<void> {
  const row = { key: ROW_KEY, value: providers, source: "admin", updatedAt: new Date() };
  await db.insert(adminSettings).values(row).onConflictDoUpdate({ target: adminSettings.key, set: row });
}

function mask({ apiKey, ...rest }: StoredProvider): MaskedProvider {
  return { ...rest, hasApiKey: Boolean(apiKey) };
}

function clean(input: ProviderInput, current?: StoredProvider): Omit<StoredProvider, "id" | "createdAt" | "updatedAt"> {
  const model = input.defaultModel ?? current?.defaultModel ?? null;
  const options = input.defaultModelOptions ?? current?.defaultModelOptions ?? null;
  let apiKey = current?.apiKey ?? null;
  let apiKeyLast4 = current?.apiKeyLast4 ?? null;
  if (input.apiKey !== undefined) {
    apiKey = input.apiKey ? seal(input.apiKey, KEY_PURPOSE) : null;
    apiKeyLast4 = input.apiKey ? input.apiKey.slice(-4) : null;
  }
  return {
    slug: input.slug,
    displayName: input.displayName,
    providerType: input.providerType,
    baseUrl: input.providerType === "custom-openai" || input.providerType === "openai" ? (input.baseUrl ?? null) : null,
    apiKey,
    apiKeyLast4,
    defaultModel: model || null,
    defaultVoice: input.defaultVoice ?? current?.defaultVoice ?? null,
    defaultInstructions: input.defaultInstructions ?? current?.defaultInstructions ?? null,
    defaultModelOptions:
      input.providerType === "openrouter" && options && model ? normalizeOpenRouterOptions(options, model) || null : null,
    enabled: input.enabled ?? current?.enabled ?? true,
  };
}

export async function listProviders(): Promise<MaskedProvider[]> {
  return (await readAll()).map(mask);
}

export async function createProvider(input: ProviderInput): Promise<MaskedProvider> {
  const all = await readAll();
  if (all.some((p) => p.slug === input.slug)) throw new ProviderError(`A provider named "${input.slug}" already exists.`, 409);
  const now = new Date().toISOString();
  const created: StoredProvider = { id: randomUUID(), createdAt: now, updatedAt: now, ...clean(input) };
  await writeAll([...all, created]);
  return mask(created);
}

export async function updateProvider(id: string, input: ProviderInput): Promise<MaskedProvider> {
  const all = await readAll();
  const index = all.findIndex((p) => p.id === id);
  if (index < 0) throw new ProviderError("Provider not found", 404);
  if (all.some((p) => p.slug === input.slug && p.id !== id)) {
    throw new ProviderError(`A provider named "${input.slug}" already exists.`, 409);
  }
  const updated: StoredProvider = { ...all[index], ...clean(input, all[index]), updatedAt: new Date().toISOString() };
  all[index] = updated;
  await writeAll(all);
  return mask(updated);
}

export async function deleteProvider(id: string): Promise<void> {
  const all = await readAll();
  if (!all.some((p) => p.id === id)) throw new ProviderError("Provider not found", 404);
  await writeAll(all.filter((p) => p.id !== id));
}

function resolve(p: StoredProvider): ResolvedProvider {
  const { apiKey, ...stored } = p;
  const { apiKeyLast4, ...rest } = stored;
  void apiKeyLast4;
  let key = "";
  try {
    key = apiKey ? unseal(apiKey, KEY_PURPOSE) : "";
  } catch (error) {
    console.error(`Could not read the key of TTS provider ${p.slug}; was BETTER_AUTH_SECRET changed?`, error);
    throw new ProviderError(`The key of ${p.displayName} can't be read; enter it again.`, 503);
  }
  return { ...rest, apiKey: key };
}

/** A provider with its key, by id (for the admin check) or slug (for synthesis). */
export async function resolveProvider(ref: { id?: string; slug?: string }): Promise<ResolvedProvider | null> {
  const found = (await readAll()).find((p) => (ref.id ? p.id === ref.id : p.slug === ref.slug));
  return found ? resolve(found) : null;
}

/** The first enabled provider, for callers that don't name one. */
export async function defaultProvider(): Promise<ResolvedProvider | null> {
  const found = (await readAll()).find((p) => p.enabled);
  return found ? resolve(found) : null;
}

/** Which provider and voices the podcast workflow speaks with. */
export const speechSettingsSchema = z.object({
  provider: z.string().trim().max(64).nullable(),
  hostVoices: z.tuple([z.string().trim().max(200), z.string().trim().max(200)]),
  speed: z.number().min(0.5).max(2),
});
export type SpeechSettings = z.infer<typeof speechSettingsSchema>;

const SPEECH_KEY = "ttsSpeech";
const DEFAULT_SPEECH: SpeechSettings = { provider: null, hostVoices: ["", ""], speed: 1 };

export async function getSpeechSettings(): Promise<SpeechSettings> {
  const [row] = await db.select().from(adminSettings).where(eq(adminSettings.key, SPEECH_KEY));
  const parsed = speechSettingsSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_SPEECH;
}

export async function saveSpeechSettings(value: SpeechSettings): Promise<SpeechSettings> {
  if (value.provider && !(await readAll()).some((p) => p.slug === value.provider)) {
    throw new ProviderError(`No provider named "${value.provider}".`);
  }
  const row = { key: SPEECH_KEY, value, source: "admin", updatedAt: new Date() };
  await db.insert(adminSettings).values(row).onConflictDoUpdate({ target: adminSettings.key, set: row });
  return value;
}
