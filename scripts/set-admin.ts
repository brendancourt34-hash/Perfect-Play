/**
 * Grants (or revokes) admin-dashboard access for a user by email.
 *
 * Usage:
 *   npx dotenv -e .env.local -- npx tsx scripts/set-admin.ts someone@example.com true
 *   npx dotenv -e .env.local -- npx tsx scripts/set-admin.ts someone@example.com false
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

async function main() {
  const [email, flag] = process.argv.slice(2);
  if (!email || (flag !== "true" && flag !== "false")) {
    console.error("Usage: set-admin.ts <email> <true|false>");
    process.exit(1);
  }
  const isAdmin = flag === "true";
  const [user] = await db.update(schema.users).set({ isAdmin }).where(eq(schema.users.email, email.trim().toLowerCase())).returning();
  if (!user) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }
  console.log(`${user.email} isAdmin -> ${user.isAdmin}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
