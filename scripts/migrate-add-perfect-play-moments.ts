/**
 * Perfect Play Moments — additive migration. Adds ONE new table, no changes to any
 * existing table. See src/lib/perfect2/moments.ts for the progression engine and
 * src/lib/data/moments.ts for the persistence layer this table backs.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-add-perfect-play-moments.ts
 *
 * Idempotent — safe to re-run (IF NOT EXISTS throughout).
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS perfect_play_moments (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      competition_id integer NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
      sport_id integer NOT NULL REFERENCES sports(id) ON DELETE CASCADE,
      type varchar(32) NOT NULL,
      message text NOT NULL,
      correct_selections integer NOT NULL,
      incorrect_selections integer NOT NULL,
      total_selections integer NOT NULL,
      dedupe_key varchar(160) NOT NULL,
      read_at timestamp with time zone,
      created_at timestamp with time zone NOT NULL DEFAULT now()
    );
  `);
  await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS perfect_play_moments_dedupe_key_unique ON perfect_play_moments (dedupe_key);`);
  await sql.query(`CREATE INDEX IF NOT EXISTS perfect_play_moments_user_created_idx ON perfect_play_moments (user_id, created_at);`);

  const cols = await sql.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='perfect_play_moments' ORDER BY ordinal_position`,
  );
  console.log("perfect_play_moments columns:", cols);
}

main()
  .then(() => {
    console.log("Migration complete.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
