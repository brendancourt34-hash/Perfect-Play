/**
 * MIGRATION — adds week_start_date to round_game_selections (NBA weekly-window fix).
 *
 * Root-cause fix for NBA rounds being assembled from games scattered across unrelated
 * weeks/months: the auto-selection generator previously bucketed eligible games by
 * day-of-week name ALONE (e.g. "thursday") across the entire remaining season, so "2
 * Thursday games" could come from two completely different months. This column pins each
 * day-bucketed selection (NBA today) to the single real Thursday-Sunday week it was drawn
 * from — see src/lib/data/auto-round-selection.ts.
 *
 * Additive only: no existing column, table, or row is altered/removed structurally.
 * Existing rows get week_start_date = NULL (backfilled separately by the round
 * regeneration script, since those rows are being replaced anyway — see
 * scripts/_tmp_regenerate_nba_rounds.mjs run alongside this).
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-add-nba-week-window.ts
 *
 * Idempotent — safe to re-run (IF NOT EXISTS throughout).
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  await sql.query(`ALTER TABLE round_game_selections ADD COLUMN IF NOT EXISTS week_start_date date;`);

  // Postgres treats every NULL as distinct in a unique index, so this only ever
  // constrains rows that actually set week_start_date (NBA) — a complete no-op for NFL,
  // which never sets it.
  await sql.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'round_game_selections_sport_season_week_unique'
      ) THEN
        ALTER TABLE round_game_selections
          ADD CONSTRAINT round_game_selections_sport_season_week_unique
          UNIQUE (sport_id, season_id, week_start_date);
      END IF;
    END $$;
  `);

  const cols = await sql.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='round_game_selections' ORDER BY ordinal_position`,
  );
  console.log("round_game_selections columns:", cols);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
