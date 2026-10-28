/**
 * PHASE 19 MIGRATION — adds the prize-pool/rollover fields.
 *
 * All additive, all safely defaulted — no existing column's meaning changes.
 * competitions.prizeAmountCents remains exactly what it always was: the configured BASE
 * prize. Current pool = prizeAmountCents + rolloverInCents (computed, never stored
 * redundantly as a third column, so there's only ever one source of truth per component).
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-add-prize-pool-fields.ts
 *
 * Idempotent — safe to re-run (IF NOT EXISTS).
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  await sql.query(`
    ALTER TABLE competitions
      ADD COLUMN IF NOT EXISTS rollover_in_cents integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS rollover_out_cents integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS rollover_claimed boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS winner_count integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS awarded_amount_cents integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS prize_settled_at timestamp with time zone;
  `);
  await sql.query(`
    ALTER TABLE competition_entries
      ADD COLUMN IF NOT EXISTS prize_allocation_cents integer NOT NULL DEFAULT 0;
  `);

  const compCols = await sql.query(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='competitions' AND column_name LIKE '%rollover%' OR table_name='competitions' AND column_name IN ('winner_count','awarded_amount_cents','prize_settled_at')`,
  );
  const entryCols = await sql.query(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='competition_entries' AND column_name='prize_allocation_cents'`,
  );
  console.log("competitions new columns:", compCols);
  console.log("competition_entries new columns:", entryCols);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
