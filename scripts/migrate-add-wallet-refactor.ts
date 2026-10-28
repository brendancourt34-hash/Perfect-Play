/**
 * PHASE 23 CORRECTIVE MIGRATION — refactors the wallet from a `users.balance_cents`
 * column into a proper `wallets` table (1:1 with users), adds the `withdrawals`
 * lifecycle table, and widens `wallet_transactions` with `currency`,
 * `balance_before_cents`, and `related_withdrawal_id`.
 *
 * This corrects scripts/migrate-add-wallet-packages-terms.ts, which shipped the wallet as
 * a `users.balance_cents` column before the user's more detailed follow-up spec explicitly
 * asked for a separate `wallets` table plus a `withdrawals` table plus a richer
 * `wallet_transactions` shape (balance_before_cents, a `winning_credit` type name instead
 * of `prize_credit`). No user-facing data existed against the old column yet (Phase 23 has
 * not shipped), so this drops it rather than migrating values.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-add-wallet-refactor.ts
 *
 * Idempotent — safe to re-run (IF NOT EXISTS / IF EXISTS throughout).
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  // --- New wallets table (1:1 with users) ---
  await sql.query(`
    CREATE TABLE IF NOT EXISTS wallets (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      balance_cents integer NOT NULL DEFAULT 0,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    );
  `);
  await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS wallets_user_id_unique ON wallets (user_id);`);

  // Backfill a zero-balance wallet row for every existing user so debit/credit lookups
  // never have to special-case "no wallet row yet".
  await sql.query(`
    INSERT INTO wallets (user_id, balance_cents)
    SELECT id, 0 FROM users
    ON CONFLICT DO NOTHING;
  `);

  // --- Drop the superseded column now that wallets carries the balance ---
  await sql.query(`ALTER TABLE users DROP COLUMN IF EXISTS balance_cents;`);

  // --- withdrawals lifecycle table ---
  await sql.query(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount_cents integer NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'requested',
      admin_note text,
      requested_at timestamp with time zone NOT NULL DEFAULT now(),
      processed_at timestamp with time zone
    );
  `);

  // --- Widen wallet_transactions ---
  await sql.query(`ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS currency varchar(3) NOT NULL DEFAULT 'AUD';`);
  await sql.query(`ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS balance_before_cents integer;`);
  // Backfill any pre-existing rows (there should be none from a real user yet, only
  // possible QA fixtures) so the NOT NULL below can be applied safely.
  await sql.query(`UPDATE wallet_transactions SET balance_before_cents = balance_after_cents - amount_cents WHERE balance_before_cents IS NULL;`);
  await sql.query(`ALTER TABLE wallet_transactions ALTER COLUMN balance_before_cents SET NOT NULL;`);
  await sql.query(`ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS related_withdrawal_id integer;`);

  // Rename the old "prize_credit" type value (if any rows used it) to "winning_credit" to
  // match the renamed enum value.
  await sql.query(`UPDATE wallet_transactions SET type = 'winning_credit' WHERE type = 'prize_credit';`);

  const tables = ["wallets", "withdrawals", "wallet_transactions", "users"];
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
