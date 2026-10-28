/**
 * MIGRATION — stops game_lineups.is_starting from being a fabricated NOT NULL true, and
 * adds a real, provider-derived injury_status column.
 *
 * Root cause: NbaEspnProvider.listGamePlayers() unconditionally wrote isStarting=true for
 * every player (no real pre-game starting-lineup signal exists in ESPN's free API), and
 * the eligibility picker showed both teams' FULL rosters (37 players for one game) with
 * no way to exclude players ESPN already reports as definitely OUT.
 *
 * Additive/relaxing only:
 *  - is_starting: NOT NULL DROPPED (relaxing, not narrowing) — existing `true` rows are
 *    left as-is (harmless historical noise, never read as meaningful), new NBA rows will
 *    write NULL instead of a fabricated true. NRL/AFL/NFL are unaffected: their sync path
 *    (mock-provider.ts, the only one that runs today) always explicitly supplies `true`
 *    itself, never relying on the column's own default.
 *  - injury_status: new nullable column, additive only.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-add-nba-injury-status.ts
 *
 * Idempotent — safe to re-run.
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  await sql.query(`ALTER TABLE game_lineups ALTER COLUMN is_starting DROP NOT NULL;`);
  await sql.query(`ALTER TABLE game_lineups ALTER COLUMN is_starting DROP DEFAULT;`);
  await sql.query(`ALTER TABLE game_lineups ADD COLUMN IF NOT EXISTS injury_status varchar(16);`);

  const cols = await sql.query(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='game_lineups' ORDER BY ordinal_position`,
  );
  console.log("game_lineups columns:", cols);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
