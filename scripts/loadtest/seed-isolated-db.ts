/**
 * Seeds the minimal rows the application assumes exist — entry packages (1/5/10) and the
 * max-entries-per-round platform setting — into the isolated LOAD_TEST_DATABASE_URL.
 * Mirrors exactly what scripts/migrate-add-wallet-packages-terms.ts seeds for the real
 * app database; never invents different values.
 *
 *   LOAD_TEST_DATABASE_URL=... npx tsx scripts/loadtest/seed-isolated-db.ts
 */
import { assertSafeLoadTestDatabase, getLoadTestDb } from "./db-client";
import * as schema from "../../src/db/schema";

async function main() {
  assertSafeLoadTestDatabase(process.env.LOAD_TEST_DATABASE_URL, process.env.DATABASE_URL);
  const db = getLoadTestDb();

  const existingSettings = await db.select().from(schema.platformSettings);
  if (!existingSettings.some((s) => s.key === "max_entries_per_round")) {
    await db.insert(schema.platformSettings).values({ key: "max_entries_per_round", value: 10 });
  }

  const existingPackages = await db.select().from(schema.entryPackages);
  if (existingPackages.length === 0) {
    await db.insert(schema.entryPackages).values([
      { entryCount: 1, priceCents: 500, label: "1 Entry", badge: null, displayOrder: 0 },
      { entryCount: 5, priceCents: 2000, label: "5 Entries", badge: null, displayOrder: 1 },
      { entryCount: 10, priceCents: 3500, label: "10 Entries", badge: "BEST VALUE", displayOrder: 2 },
    ]);
  }

  console.log("Isolated load-test database seeded: entry packages + platform settings ready.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seeding failed:", err);
    process.exit(1);
  });
