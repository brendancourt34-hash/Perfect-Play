/**
 * MIGRATION — adds wallet_transactions.idempotency_key, a nullable, unique client-
 * supplied key for debits that have no pre-existing row to key idempotency off (unlike a
 * withdrawal, which already has a `withdrawals` row before its debit happens). Needed for
 * entry-package purchases: a double-tap of "Enter" or a network retry must never debit
 * the wallet or create entries twice — see debitWallet/purchaseEntryPackage.
 *
 * Additive only. Postgres unique indexes never treat multiple NULLs as duplicates, so
 * this is a complete no-op for every existing transaction type that doesn't set it.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-add-wallet-idempotency-key.ts
 *
 * Idempotent — safe to re-run.
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  await sql.query(`ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS idempotency_key varchar(64);`);
  await sql.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transactions_idempotency_key_unique'
      ) THEN
        ALTER TABLE wallet_transactions
          ADD CONSTRAINT wallet_transactions_idempotency_key_unique UNIQUE (idempotency_key);
      END IF;
    END $$;
  `);

  const cols = await sql.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='wallet_transactions' ORDER BY ordinal_position`,
  );
  console.log("wallet_transactions columns:", cols);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
