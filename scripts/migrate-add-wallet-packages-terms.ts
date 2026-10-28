/**
 * PHASE 23 MIGRATION — Perfect 2 Balance (wallet), multi-entry packages, and Terms &
 * Conditions.
 *
 * Additive except for ONE deliberate, explicitly-required change: the old
 * one-entry-per-user-per-competition UNIQUE constraint on competition_entries is dropped
 * (replaced by a plain index for the same lookup performance) — a multi-entry product
 * structurally cannot have that constraint. No existing row is deleted or altered; every
 * existing entry remains exactly as it was. The 10-entry cap is enforced in application
 * logic (src/lib/data/entry-packages.ts), not the schema, since it's a configurable
 * business rule (platform_settings.max_entries_per_round), not a structural invariant.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-add-wallet-packages-terms.ts
 *
 * Idempotent — safe to re-run (IF NOT EXISTS / IF EXISTS throughout).
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function main() {
  // --- Wallet ---
  await sql.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_cents integer NOT NULL DEFAULT 0;`);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type varchar(16) NOT NULL,
      amount_cents integer NOT NULL,
      balance_after_cents integer NOT NULL,
      description text NOT NULL,
      related_payment_transaction_id integer REFERENCES payment_transactions(id) ON DELETE SET NULL,
      related_competition_id integer REFERENCES competitions(id) ON DELETE SET NULL,
      related_entry_ids jsonb,
      created_at timestamp with time zone NOT NULL DEFAULT now()
    );
  `);
  await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_idempotency_unique ON wallet_transactions (related_payment_transaction_id);`);
  await sql.query(`CREATE INDEX IF NOT EXISTS wallet_transactions_user_id_idx ON wallet_transactions (user_id);`);

  // --- Entry packages + generic platform settings ---
  await sql.query(`
    CREATE TABLE IF NOT EXISTS entry_packages (
      id serial PRIMARY KEY,
      entry_count integer NOT NULL,
      price_cents integer NOT NULL,
      label text NOT NULL,
      badge text,
      active boolean NOT NULL DEFAULT true,
      display_order integer NOT NULL DEFAULT 0,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    );
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key varchar(64) PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    );
  `);

  // --- Terms & Conditions ---
  await sql.query(`
    CREATE TABLE IF NOT EXISTS terms_versions (
      id serial PRIMARY KEY,
      version_number varchar(32) NOT NULL,
      effective_date date NOT NULL,
      published_at timestamp with time zone,
      status varchar(16) NOT NULL DEFAULT 'draft',
      content jsonb NOT NULL,
      created_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    );
  `);
  await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS terms_versions_version_number_unique ON terms_versions (version_number);`);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS terms_acceptances (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      terms_version_id integer NOT NULL REFERENCES terms_versions(id) ON DELETE CASCADE,
      accepted_at timestamp with time zone NOT NULL DEFAULT now(),
      ip_address varchar(64),
      user_agent text
    );
  `);
  await sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS terms_acceptances_user_version_unique ON terms_acceptances (user_id, terms_version_id);`);

  // --- The one deliberate, explicitly-required constraint change ---
  await sql.query(`ALTER TABLE competition_entries DROP CONSTRAINT IF EXISTS competition_entries_competition_user_unique;`);
  await sql.query(`CREATE INDEX IF NOT EXISTS competition_entries_competition_user_idx ON competition_entries (competition_id, user_id);`);

  // --- Seed defaults (idempotent: only inserts if not already present) ---
  const existingSettings = await sql.query(`SELECT key FROM platform_settings WHERE key = 'max_entries_per_round'`);
  if (existingSettings.length === 0) {
    await sql.query(`INSERT INTO platform_settings (key, value) VALUES ('max_entries_per_round', '10'::jsonb)`);
  }

  const existingPackages = await sql.query(`SELECT id FROM entry_packages LIMIT 1`);
  if (existingPackages.length === 0) {
    await sql.query(`
      INSERT INTO entry_packages (entry_count, price_cents, label, badge, display_order) VALUES
        (1, 500, '1 Entry', NULL, 0),
        (5, 2000, '5 Entries', NULL, 1),
        (10, 3500, '10 Entries', 'BEST VALUE', 2)
    `);
  }

  const tables = ["users", "wallet_transactions", "entry_packages", "platform_settings", "terms_versions", "terms_acceptances", "competition_entries"];
  for (const table of tables) {
    const cols = await sql.query(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`,
      [table],
    );
    console.log(`${table} columns:`, cols);
  }
  const constraints = await sql.query(
    `SELECT conname FROM pg_constraint WHERE conrelid = 'competition_entries'::regclass`,
  );
  console.log("competition_entries constraints:", constraints);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
