/**
 * PHASE 23F MIGRATION — two additive/relaxation changes for the "pick 1 player per game"
 * rules update:
 *
 * 1. Relaxes entry_selections.selected_player_2_id and player_2_result from NOT NULL to
 *    nullable, so a new 1-pick entry can simply omit the second slot instead of requiring
 *    a fake/duplicate value. Purely a constraint relaxation — DROP NOT NULL never touches
 *    existing data, so every historical 2-pick entry keeps its real
 *    selected_player_2_id/player_2_result exactly as persisted. No column dropped/renamed.
 *
 * 2. Adds player_game_stats.touchdowns (NFL's required stat), the same dedicated-column
 *    treatment as tries/goals/points. Additive, defaults 0, never touches existing rows'
 *    meaning.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-phase23f-single-selection.ts
 *
 * Idempotent — DROP NOT NULL on an already-nullable column, and ADD COLUMN IF NOT EXISTS,
 * are both no-ops on re-run.
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  await sql.query(`ALTER TABLE entry_selections ALTER COLUMN selected_player_2_id DROP NOT NULL;`);
  await sql.query(`ALTER TABLE entry_selections ALTER COLUMN player_2_result DROP NOT NULL;`);
  await sql.query(`ALTER TABLE entry_selections ALTER COLUMN player_2_result DROP DEFAULT;`);
  await sql.query(`ALTER TABLE player_game_stats ADD COLUMN IF NOT EXISTS touchdowns integer NOT NULL DEFAULT 0;`);

  const selectionRows = await sql.query(
    `SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name='entry_selections' AND column_name IN ('selected_player_2_id','player_2_result') ORDER BY column_name`,
  );
  console.log("entry_selections nullable-slot-2 columns:", selectionRows);

  const statRows = await sql.query(
    `SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name='player_game_stats' AND column_name='touchdowns'`,
  );
  console.log("player_game_stats.touchdowns column:", statRows);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
