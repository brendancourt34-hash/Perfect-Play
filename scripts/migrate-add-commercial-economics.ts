/**
 * PHASE 23E MIGRATION — adds competitions.prize_pool_allocation_bps (nullable integer,
 * basis points; null = inherit the global platform_settings default).
 *
 * This is a commercial-economics MODELING layer, entirely additive and separate from the
 * existing Phase 19 prizeAmountCents/rollover columns, which are completely untouched.
 * No existing row's real prize configuration or settlement state is affected — every
 * existing competition simply gets prize_pool_allocation_bps = NULL, meaning "use the
 * global default" (see src/lib/data/platform-settings.ts:getPrizePoolAllocationBps).
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-add-commercial-economics.ts
 *
 * Idempotent — safe to re-run (IF NOT EXISTS).
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  await sql.query(`ALTER TABLE competitions ADD COLUMN IF NOT EXISTS prize_pool_allocation_bps integer;`);

  const rows = await sql.query(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='competitions' AND column_name='prize_pool_allocation_bps'`,
  );
  console.log("competitions.prize_pool_allocation_bps column:", rows);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
