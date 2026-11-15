import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
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
