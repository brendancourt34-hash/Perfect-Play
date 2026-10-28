/**
 * PHASE 22 MIGRATION — adds NBA-supporting columns to existing tables.
 *
 * Additive only: no existing column, table, or row is altered/removed. NBA (points >= 20)
 * reuses every existing table (sports, seasons, rounds, teams, players, games,
 * game_lineups, player_game_stats, competitions, competition_entries, entry_selections) —
 * this only adds columns those tables didn't need until a sport with a curated-from-a-
 * larger-slate schedule and a dedicated points stat existed.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-add-nba-support.ts
 *
 * Idempotent — safe to re-run (IF NOT EXISTS throughout).
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  // Points is a first-class stat (like tries/goals), not a rare sport-specific extra —
  // gets a dedicated column per the schema's own existing convention.
  await sql.query(`ALTER TABLE player_game_stats ADD COLUMN IF NOT EXISTS points integer NOT NULL DEFAULT 0;`);

  // Player photo — genuinely useful for any sport, not NBA-only; NRL/AFL simply leave it null.
  await sql.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS photo_url text;`);

  // Which Perfect 2 round "slot" a curated game was assigned to (e.g. "thursday",
  // "friday") — only meaningful for sports that curate N games out of a larger real
  // schedule (NBA today); null and unused for NRL/AFL, which use every game in the round.
  await sql.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS slot_label varchar(16);`);

  // Marks a round as the sport's rolling "schedule pool" — synced-but-not-yet-curated
  // real games land here (roundId points at this row) until an admin assigns them into a
  // real customer-facing Perfect 2 round. Never used for entries; getOrCreateCompetition
  // is never called against a schedule-pool round.
  await sql.query(`ALTER TABLE rounds ADD COLUMN IF NOT EXISTS is_schedule_pool boolean NOT NULL DEFAULT false;`);

  const tables = ["player_game_stats", "players", "games", "rounds"];
  for (const table of tables) {
    const cols = await sql.query(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`,
      [table],
    );
    console.log(`${table} columns:`, cols);
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
