import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { pool?: Pool };

// One pool per process; dev hot reloads would otherwise open a new one each time.
const pool = (globalForDb.pool ??= new Pool({ connectionString: process.env.POSTGRES_URL }));

export const db = drizzle(pool, { schema });
