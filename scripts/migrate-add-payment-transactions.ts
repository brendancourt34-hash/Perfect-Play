/**
 * PHASE 20 MIGRATION — adds the payment_transactions table.
 *
 * Additive only: no existing table is modified, no existing row is touched. The existing
 * competition_entries payment columns (paymentStatus, paidAmountCents) are preserved
 * exactly as-is and continue to reflect "this entry's current payment state" — this new
 * table is durable, append-oriented HISTORY (every attempt, retry, and eventual refund),
 * which a handful of scalar columns on one row can't represent.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-add-payment-transactions.ts
 *
 * Idempotent — safe to re-run (IF NOT EXISTS throughout).
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS payment_transactions (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      competition_entry_id integer REFERENCES competition_entries(id) ON DELETE SET NULL,
      competition_id integer REFERENCES competitions(id) ON DELETE SET NULL,
      provider varchar(32) NOT NULL,
      provider_transaction_id varchar(128),
      idempotency_key varchar(128) NOT NULL,
      amount_cents integer NOT NULL,
      currency varchar(3) NOT NULL DEFAULT 'AUD',
      status varchar(16) NOT NULL DEFAULT 'pending',
      transaction_type varchar(16) NOT NULL DEFAULT 'payment',
      failure_code varchar(64),
      failure_message text,
      metadata jsonb,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now(),
      completed_at timestamp with time zone
    );
  `);
  await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_idempotency_key_unique ON payment_transactions (idempotency_key);`);
  await sql.query(`CREATE INDEX IF NOT EXISTS payment_transactions_user_id_idx ON payment_transactions (user_id);`);
  await sql.query(`CREATE INDEX IF NOT EXISTS payment_transactions_competition_id_idx ON payment_transactions (competition_id);`);
  await sql.query(`CREATE INDEX IF NOT EXISTS payment_transactions_provider_transaction_id_idx ON payment_transactions (provider_transaction_id);`);

  const cols = await sql.query(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='payment_transactions' ORDER BY ordinal_position`,
  );
  console.log("payment_transactions columns:", cols);
  const indexes = await sql.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'payment_transactions'`);
  console.log("payment_transactions indexes:", indexes);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
