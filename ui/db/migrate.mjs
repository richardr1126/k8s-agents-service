// Applies db/migrations. Safe to run from several replicas at once: a session
// advisory lock makes them take turns, and the later ones find nothing to do.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { existsSync } from "node:fs";
import pg from "pg";

for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);
if (!process.env.POSTGRES_URL) throw new Error("POSTGRES_URL is not set");

const LOCK_KEY = "k8s-agents-ui:migrate";
const client = new pg.Client({ connectionString: process.env.POSTGRES_URL });
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [LOCK_KEY]);
  await migrate(drizzle(client), { migrationsFolder: new URL("./migrations", import.meta.url).pathname });
  console.log("migrations applied");
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [LOCK_KEY]).catch(() => {});
  await client.end();
}
