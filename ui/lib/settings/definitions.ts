// Admin settings: each key's type, default and admin-panel copy, defined once.
// The seed file's JSON Schema (settings.schema.json) is generated from here
// with `pnpm settings:schema`, so this file imports only zod and uses only
// type syntax Node can strip.
import { z } from "zod";

const runWindow = z.object({
  perMinute: z.int().min(0).describe("Runs per minute. 0 turns the window off."),
  perDay: z.int().min(0).describe("Runs per day. 0 turns the window off."),
});

export const SETTINGS = {
  signupPolicy: {
    schema: z.enum(["open", "approval", "closed"]),
    default: "open" as const,
    label: "New account sign-ups",
    description: "Open lets anyone register; approval holds new accounts until an admin approves them; closed refuses new accounts.",
  },
  allowGuests: {
    schema: z.boolean(),
    default: true,
    label: "Guest sessions",
    description: "Shows “Continue as guest” on the sign-in page. Turning it off signs existing guests out.",
  },
  runLimits: {
    schema: z.object({ guest: runWindow, user: runWindow }),
    default: { guest: { perMinute: 2, perDay: 3 }, user: { perMinute: 5, perDay: 15 } },
    label: "Run limits",
    description: "Agent runs each guest or account may start. Admins and exempt users have no limit.",
  },
  enabledModels: {
    schema: z.array(z.string().min(1)),
    default: [] as string[],
    label: "Models offered",
    description: "Models people can pick, from those the agent service serves. Empty offers all of them.",
  },
  defaultModel: {
    schema: z.string().min(1).nullable(),
    default: null as string | null,
    label: "Default model",
    description: "Model new chats start with. Unset uses the agent service's default.",
  },
  autoTitle: {
    schema: z.boolean(),
    default: true,
    label: "Name new chats automatically",
    description: "Asks the title model for a short name after the first message.",
  },
  titleModel: {
    schema: z.string().min(1),
    default: "google/gemini-3.1-flash-lite",
    label: "Title model",
    description: "Any OpenRouter model id that supports structured outputs. Pick a small, cheap one.",
  },
  openreaderUrl: {
    schema: z.url({ protocol: /^https?$/ }).nullable(),
    default: null as string | null,
    label: "OpenReader instance",
    description: "The OpenReader people connect for read-aloud and podcasts, such as https://openreader.richardr.dev. Unset uses OPENREADER_URL. Changing it asks everyone to reconnect.",
  },
};

export type SettingKey = keyof typeof SETTINGS;
export type Settings = { [K in SettingKey]: z.output<(typeof SETTINGS)[K]["schema"]> };
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function defaultSettings(): Settings {
  return structuredClone(
    Object.fromEntries(SETTING_KEYS.map((key) => [key, SETTINGS[key].default])),
  ) as Settings;
}

/** Validates one setting; undefined when the value does not fit the key. */
export function parseSetting<K extends SettingKey>(key: K, value: unknown): Settings[K] | undefined {
  const result = SETTINGS[key].schema.safeParse(value);
  return result.success ? (result.data as Settings[K]) : undefined;
}

export const accountEmailSeedSchema = z
  .object({
    enabled: z.boolean().default(false).describe("Send verification and password-reset emails."),
    senderName: z.string().min(1).describe("Shown as the sender, for example “chat.richardr.dev”."),
    senderEmail: z.email().describe("An address on a domain verified in Resend."),
    replyTo: z.email().nullable().default(null),
    apiKey: z.string().min(1).describe("Resend API key. Stored encrypted with BETTER_AUTH_SECRET."),
  })
  .strict();

export const seedSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(1),
    settings: z
      .object(
        Object.fromEntries(
          SETTING_KEYS.map((key) => [
            key,
            SETTINGS[key].schema.optional().describe(`${SETTINGS[key].label}. ${SETTINGS[key].description}`),
          ]),
        ),
      )
      .strict()
      .optional()
      .describe("Admin settings to fill in on first start. Values an admin has set are never replaced."),
    accountEmail: accountEmailSeedSchema
      .optional()
      .describe("Account email through Resend. Applied only when none is saved yet."),
  })
  .strict()
  .meta({
    title: "chat.richardr.dev seed",
    description: "Starting values for admin settings, read from RUNTIME_SEED_JSON or RUNTIME_SEED_JSON_PATH.",
  });

export type Seed = z.output<typeof seedSchema>;

export function seedJsonSchema() {
  return z.toJSONSchema(seedSchema, { io: "input" });
}
