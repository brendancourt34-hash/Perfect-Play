import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Lazily-created DB client. Next.js evaluates top-level module code at build
 * time, and `neon()` throws immediately if DATABASE_URL is unset — lazy init
 * keeps `next build` working before a database has been provisioned.
 */
function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Provision a Postgres database (e.g. `vercel integration add neon`) " +
        "and add its connection string to your environment before querying the database.",
    );
  }
  const sql = neon(url);
  return drizzle(sql, { schema });
}

let _db: ReturnType<typeof createDb> | null = null;

export function getDb() {
  if (!_db) _db = createDb();
  return _db;
}

export { schema };
