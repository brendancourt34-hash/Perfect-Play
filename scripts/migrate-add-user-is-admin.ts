/**
 * PHASE 18 MIGRATION — adds users.is_admin (boolean, not null, default false).
 *
 * Smallest possible schema change for admin authorization: reuses the existing users/
 * sessions authentication system (no second auth system), defaults every existing and
 * future row to false (nobody is silently promoted), and touches no other table. Run
 * once against the live database:
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-add-user-is-admin.ts
 *
 * Idempotent — safe to re-run (IF NOT EXISTS).
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  await sql.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;`);
  const rows = await sql.query(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='users' AND column_name='is_admin'`,
  );
  console.log("users.is_admin column:", rows);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
