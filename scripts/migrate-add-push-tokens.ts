/**
 * Push-token registry — additive migration. Architecture-ready for Expo push
 * notifications; nothing sends a real push yet (expo-notifications isn't installed in
 * mobile/). See src/db/schema.ts's pushTokens doc comment.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-add-push-tokens.ts
 *
 * Idempotent — safe to re-run (IF NOT EXISTS throughout).
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS push_tokens (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token varchar(255) NOT NULL,
      platform varchar(16) NOT NULL,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      last_seen_at timestamp with time zone NOT NULL DEFAULT now()
    );
  `);
  await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS push_tokens_token_unique ON push_tokens (token);`);

  const cols = await sql.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='push_tokens' ORDER BY ordinal_position`,
  );
  console.log("push_tokens columns:", cols);
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
