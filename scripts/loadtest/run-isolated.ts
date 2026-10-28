/**
 * Runs the settlement-at-scale load test (scenarioSettlement, from ./run.ts — reused
 * unchanged, never duplicated) against a FULLY ISOLATED database and a FULLY ISOLATED app
 * server. Never touches the shared dev database or the shared dev server on :3000.
 *
 * Setup (see README.md for full detail):
 *   1. Obtain a disposable Postgres connection string and set it as LOAD_TEST_DATABASE_URL
 *      — NOT the same as your DATABASE_URL. Options: a local Postgres instance
 *      (`brew install postgresql@16` then `createdb perfect_play_loadtest`), a dedicated
 *      Neon branch/project, or Neon's instant throwaway "Claimable" projects
 *      (`npx neon@latest claim create --file .env.loadtest.local`).
 *   2. Push the schema once: `LOAD_TEST_DATABASE_URL=... npx tsx scripts/loadtest/seed-isolated-db.ts`
 *      (also seeds entry packages + platform settings).
 *   3. Run this script.
 *
 *   LOAD_TEST_CONFIRM=i-understand-this-is-not-production \
 *   LOAD_TEST_DATABASE_URL=postgresql://... \
 *   npx dotenv -e .env.local -- npx tsx scripts/loadtest/run-isolated.ts [sport] [customers]
 *
 * This script owns the isolated app server's entire lifecycle: spawns it (pointed at
 * LOAD_TEST_DATABASE_URL, on its own port and its own Next build directory — see
 * next.config.ts's LOAD_TEST_ISOLATED_DIST_DIR — so it never collides with a normal
 * `next dev` already running against the real app), waits for it to be ready, runs the
 * scenario, and always tears the server down afterward, success or failure.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { assertSafeEnvironment } from "./harness";
import { assertSafeLoadTestDatabase, getLoadTestDb, closeLoadTestDb } from "./db-client";
import { scenarioSettlement } from "./run";
import * as schema from "../../src/db/schema";

const ISOLATED_PORT = Number(process.env.LOAD_TEST_APP_PORT ?? 3003);
const ISOLATED_DIST_DIR = ".next-loadtest";
const APP_URL = `http://localhost:${ISOLATED_PORT}`;

async function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not up yet — keep polling.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Isolated app server at ${url} did not become ready within ${timeoutMs}ms.`);
}

/** Mirrors scripts/migrate-add-wallet-packages-terms.ts's seed defaults exactly — never invents different values. Safe to call every run (checks before inserting). */
async function seedMinimalData(db: ReturnType<typeof getLoadTestDb>): Promise<void> {
  const existingSettings = await db.select().from(schema.platformSettings);
  if (!existingSettings.some((s: typeof schema.platformSettings.$inferSelect) => s.key === "max_entries_per_round")) {
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
}

async function main() {
  const loadTestUrl = process.env.LOAD_TEST_DATABASE_URL;
  assertSafeLoadTestDatabase(loadTestUrl, process.env.DATABASE_URL);
  assertSafeEnvironment(APP_URL); // the isolated server is still only ever localhost — same safety gate every other scenario uses.

  const [, , sportArg, customersArg, concurrencyArg] = process.argv;
  const sportCode = sportArg ?? "nrl";
  const customerCount = customersArg ? Number(customersArg) : 1000;

  console.log("=== Isolated settlement load test ===");
  console.log(`Database:    ${new URL(loadTestUrl).hostname} (isolated — never the shared dev/production database)`);
  console.log(`App server:  ${APP_URL} (isolated — never the shared dev server on :3000)`);
  console.log(`Sport:       ${sportCode}`);
  console.log(`Customers:   ${customerCount}${concurrencyArg ? `   Concurrency override: ${concurrencyArg}` : ""}`);

  const db = getLoadTestDb();
  await seedMinimalData(db);

  console.log(`\nStarting isolated app server...`);
  const server: ChildProcess = spawn("npx", ["next", "dev", "-p", String(ISOLATED_PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: loadTestUrl, LOAD_TEST_ISOLATED_DIST_DIR: ISOLATED_DIST_DIR },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let serverErrorOutput = "";
  server.stderr?.on("data", (chunk) => {
    serverErrorOutput += String(chunk);
  });

  const cleanup = async () => {
    server.kill();
    await closeLoadTestDb();
  };
  process.on("SIGINT", () => cleanup().finally(() => process.exit(130)));

  try {
    await waitForReady(`${APP_URL}/api/sports`, 60_000);
    console.log("Isolated app server ready.\n");

    const startedAt = Date.now();
    const result = await scenarioSettlement(sportCode, customerCount, db, APP_URL);
    const durationMs = Date.now() - startedAt;

    console.log(`\n=== Isolated settlement load test: ${result.allOk ? "PASS" : "FAIL"} (${(durationMs / 1000).toFixed(1)}s) ===`);
    process.exitCode = result.allOk ? 0 : 1;
  } catch (error) {
    console.error("Isolated load test failed:", error instanceof Error ? error.message : error);
    if (error instanceof Error && error.cause) console.error("Cause:", error.cause);
    if (serverErrorOutput) console.error("Isolated app server stderr:\n", serverErrorOutput.slice(-4000));
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main();
