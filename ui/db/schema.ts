import { index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export * from "./auth-schema";

/** Thread metadata. Messages live in the backend checkpointer, keyed by the same id. */
export const threads = pgTable(
  "threads",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    agentId: text("agent_id").notNull(),
    modelId: text("model_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("threads_user_updated_idx").on(table.userId, table.updatedAt)],
);

/** Agent runs admitted per user and fixed window (see lib/run-limits.ts). */
export const runUsage = pgTable(
  "run_usage",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    window: text("window").notNull(),
    windowStart: timestamp("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.window, table.windowStart] })],
);

/**
 * Admin settings and internal markers, one JSON value per key (see lib/settings).
 * `source` says who wrote the value: json-seed, admin or system.
 */
export const adminSettings = pgTable("admin_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  source: text("source").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** Per-user acknowledgements. A guest's carry over when it signs up or signs in (lib/auth.ts). */
export const userOnboarding = pgTable("user_onboarding", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** When the user last agreed to the privacy policy; null if never. */
  privacyAcceptedAt: timestamp("privacy_accepted_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * A user's link to an OpenReader instance, which speaks for read-aloud and podcasts
 * (see lib/openreader.ts). Tokens are sealed with BETTER_AUTH_SECRET.
 */
export const openreaderConnections = pgTable("openreader_connections", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** The instance origin the tokens belong to; a different configured instance means reconnecting. */
  origin: text("origin").notNull(),
  clientId: text("client_id").notNull(),
  accessToken: text("access_token").notNull(),
  accessExpiresAt: timestamp("access_expires_at").notNull(),
  refreshToken: text("refresh_token").notNull(),
  scope: text("scope").notNull(),
  /**
   * Speech for podcast hosts 1 and 2 ({ provider, model, voice }, each optional); host 1
   * also reads replies aloud. Rows saved earlier hold bare voice IDs; see hostsOf.
   */
  hostVoices: jsonb("host_voices").$type<unknown[]>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
