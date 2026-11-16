import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  // `generate` never connects, so it works without a database.
  dbCredentials: { url: process.env.POSTGRES_URL ?? "postgres://localhost/unused" },
});
