/**
 * Phase 23I load/concurrency/throughput test runner. Run with:
 *
 *   LOAD_TEST_CONFIRM=i-understand-this-is-not-production \
 *   npx dotenv -e .env.local -- npx tsx scripts/loadtest/run.ts <scenario> [sport] [n] [concurrency]
 *
 * Scenarios: burst | duplicate | cutoff | reads | mixed | distributed | settlement
 *
 * See scripts/loadtest/harness.ts for the safety gate and concurrency primitives, and
 * scripts/loadtest/fixtures.ts for how a real per-sport round is built.
 */
import { getDb, schema } from "../../src/db";
import { eq, and, sql } from "drizzle-orm";
import { assertSafeEnvironment, runConcurrent, runPaced, timedFetch, formatResult, withRetry, type TaskResult } from "./harness";
import { createLoadTestRound, registerUsers, cleanupLoadTestFixture, type LoadTestRoundFixture, type LoadTestUser } from "./fixtures";

/** See fixtures.ts's AnyDb doc comment — same rationale, same deliberate `any`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLoadTestDb = any;

const BASE_URL = "http://localhost:3000";
assertSafeEnvironment(BASE_URL);

const db = getDb();

async function fundWallets(users: LoadTestUser[], balanceCents: number) {
  for (const u of users) {
    await db.insert(schema.wallets).values({ userId: u.userId, balanceCents }).onConflictDoUpdate({ target: schema.wallets.userId, set: { balanceCents } });
  }
}

async function getOnePack(): Promise<{ id: number; priceCents: number }> {
  const [pack] = await db.select().from(schema.entryPackages).where(eq(schema.entryPackages.entryCount, 1)).limit(1);
  return { id: pack.id, priceCents: pack.priceCents };
}

function allSelections(fixture: LoadTestRoundFixture) {
  return fixture.games.map((g) => ({ gameId: g.id, playerIds: [g.scorerId] }));
}

// ============================================================
// SCENARIO C — entry burst
// ============================================================
async function scenarioBurst(sportCode: string, n: number, concurrency: number) {
  const mark = `qa-load-burst-${sportCode}-${Date.now()}`;
  console.log(`\n=== SCENARIO C: entry burst — sport=${sportCode} n=${n} concurrency=${concurrency} ===`);
  const fixture = await createLoadTestRound(sportCode, mark);
  const users = await registerUsers(BASE_URL, mark, n);
  const pack = await getOnePack();
  await fundWallets(users, pack.priceCents);

  const result = await runConcurrent(n, concurrency, async (i) => {
    const u = users[i];
    return timedFetch(`${BASE_URL}/api/${sportCode}/rounds/${fixture.roundId}/enter-package`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${u.token}` },
      body: JSON.stringify({ packageId: pack.id, selectionsPerEntry: [allSelections(fixture)] }),
    });
  });
  console.log(formatResult(`burst ${sportCode} n=${n} c=${concurrency}`, result));

  // Financial integrity: every success -> exactly one entry, exactly one wallet debit, wallet balance == 0.
  const entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, fixture.competitionId));
  const debits = await db.select().from(schema.walletTransactions).where(eq(schema.walletTransactions.type, "entry_purchase"));
  const relevantDebits = debits.filter((d) => users.some((u) => u.userId === d.userId));
  console.log(`  financial integrity: entries=${entries.length} (expected ${result.succeeded}), debits=${relevantDebits.length} (expected ${result.succeeded})`);
  const integrityOk = entries.length === result.succeeded && relevantDebits.length === result.succeeded;
  console.log(`  financial integrity: ${integrityOk ? "PASS" : "FAIL — investigate"}`);

  await cleanupLoadTestFixture(fixture, users);
  return { result, integrityOk };
}

// ============================================================
// SCENARIO D — duplicate entry concurrency (same user, many concurrent attempts)
// ============================================================
async function scenarioDuplicate(sportCode: string, concurrency: number) {
  const mark = `qa-load-dup-${sportCode}-${Date.now()}`;
  console.log(`\n=== SCENARIO D: duplicate-entry concurrency — sport=${sportCode} concurrency=${concurrency} ===`);
  const fixture = await createLoadTestRound(sportCode, mark);
  const users = await registerUsers(BASE_URL, mark, 1);
  const user = users[0];

  const result = await runConcurrent(concurrency, concurrency, async () =>
    timedFetch(`${BASE_URL}/api/${sportCode}/rounds/${fixture.roundId}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({ selections: allSelections(fixture) }),
    }),
  );
  console.log(formatResult(`duplicate-entry ${sportCode} concurrency=${concurrency}`, result));

  const entries = await db.select().from(schema.competitionEntries).where(and(eq(schema.competitionEntries.competitionId, fixture.competitionId), eq(schema.competitionEntries.userId, user.userId)));
  const transactions = await db.select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.userId, user.userId));
  console.log(`  financial integrity: ${concurrency} concurrent identical requests -> entries=${entries.length} (expect 1), payment_transactions=${transactions.length} (expect 1)`);
  const integrityOk = entries.length === 1 && transactions.length === 1;
  console.log(`  financial integrity: ${integrityOk ? "PASS" : "FAIL — investigate"}`);

  await cleanupLoadTestFixture(fixture, users);
  return { result, integrityOk };
}

// ============================================================
// SCENARIO E — cutoff race
// ============================================================
async function scenarioCutoff(sportCode: string) {
  const mark = `qa-load-cutoff-${sportCode}-${Date.now()}`;
  console.log(`\n=== SCENARIO E: cutoff race — sport=${sportCode} ===`);
  const fixture = await createLoadTestRound(sportCode, mark);
  // Move cutoff (the first game's kickoff) to 2.5s from now, real wall-clock time.
  const cutoffAt = Date.now() + 2500;
  await db.update(schema.games).set({ kickoff: new Date(cutoffAt) }).where(eq(schema.games.id, fixture.games[0].id));

  const waveSize = 20;
  const users = await registerUsers(BASE_URL, mark, waveSize * 3);

  async function fireWaveAt(targetMs: number, offset: string, userSlice: LoadTestUser[]): Promise<{ offset: string; results: TaskResult[] }> {
    const wait = targetMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const results = await Promise.all(
      userSlice.map((u) =>
        timedFetch(`${BASE_URL}/api/${sportCode}/rounds/${fixture.roundId}/entries`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${u.token}` },
          body: JSON.stringify({ selections: allSelections(fixture) }),
        }),
      ),
    );
    return { offset, results };
  }

  const before = await fireWaveAt(cutoffAt - 800, "-800ms (before cutoff)", users.slice(0, waveSize));
  const at = await fireWaveAt(cutoffAt, "0ms (at cutoff)", users.slice(waveSize, waveSize * 2));
  const after = await fireWaveAt(cutoffAt + 800, "+800ms (after cutoff)", users.slice(waveSize * 2, waveSize * 3));

  for (const wave of [before, at, after]) {
    const okCount = wave.results.filter((r) => r.ok).length;
    console.log(`  wave ${wave.offset}: ${okCount}/${wave.results.length} accepted (status codes: ${JSON.stringify(wave.results.reduce((acc: Record<string, number>, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; }, {}))})`);
  }

  const beforeOk = before.results.filter((r) => r.ok).length;
  const afterOk = after.results.filter((r) => r.ok).length;
  // Before-cutoff wave should mostly/entirely succeed (server clock permitting); after-cutoff wave must be entirely rejected.
  const integrityOk = beforeOk === waveSize && afterOk === 0;
  console.log(`  cutoff integrity: before-cutoff accepted=${beforeOk}/${waveSize} (expect ${waveSize}), after-cutoff accepted=${afterOk}/${waveSize} (expect 0) -> ${integrityOk ? "PASS" : "FAIL — investigate"}`);

  await cleanupLoadTestFixture(fixture, users);
  return { integrityOk };
}

// ============================================================
// SCENARIO F — public read load
// ============================================================
async function scenarioReads(sportCode: string, n: number, concurrency: number) {
  const mark = `qa-load-reads-${sportCode}-${Date.now()}`;
  console.log(`\n=== SCENARIO F: public read load — sport=${sportCode} n=${n} concurrency=${concurrency} ===`);
  const fixture = await createLoadTestRound(sportCode, mark);

  const endpoints = [`/api/${sportCode}/rounds`, `/api/${sportCode}/rounds/${fixture.roundId}`, `/api/${sportCode}/rounds/${fixture.roundId}/results`, `/api/sports`];
  const result = await runConcurrent(n, concurrency, async (i) => timedFetch(`${BASE_URL}${endpoints[i % endpoints.length]}`));
  console.log(formatResult(`public reads ${sportCode} n=${n} c=${concurrency}`, result));

  await cleanupLoadTestFixture(fixture, []);
  return { result };
}

// ============================================================
// SCENARIO G — mixed realistic workload
// ============================================================
async function scenarioMixed(sportCode: string, n: number, concurrency: number) {
  const mark = `qa-load-mixed-${sportCode}-${Date.now()}`;
  console.log(`\n=== SCENARIO G: mixed workload — sport=${sportCode} n=${n} concurrency=${concurrency} ===`);
  const fixture = await createLoadTestRound(sportCode, mark);
  const writeShare = Math.ceil(n * 0.2);
  const users = await registerUsers(BASE_URL, mark, writeShare);
  const pack = await getOnePack();
  await fundWallets(users, pack.priceCents);

  let writeIdx = 0;
  const result = await runConcurrent(n, concurrency, async (i) => {
    const roll = i % 10;
    if (roll < 2 && writeIdx < users.length) {
      // 20%: entry submission (write)
      const u = users[writeIdx++];
      return timedFetch(`${BASE_URL}/api/${sportCode}/rounds/${fixture.roundId}/enter-package`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${u.token}` },
        body: JSON.stringify({ packageId: pack.id, selectionsPerEntry: [allSelections(fixture)] }),
      });
    }
    if (roll < 4) return timedFetch(`${BASE_URL}/api/${sportCode}/rounds`); // round list
    if (roll < 6) return timedFetch(`${BASE_URL}/api/${sportCode}/rounds/${fixture.roundId}`); // round detail
    if (roll < 8) return timedFetch(`${BASE_URL}/api/${sportCode}/rounds/${fixture.roundId}/results`); // results
    return timedFetch(`${BASE_URL}/api/sports`); // sports list
  });
  console.log(formatResult(`mixed ${sportCode} n=${n} c=${concurrency}`, result));

  await cleanupLoadTestFixture(fixture, users);
  return { result };
}

// ============================================================
// SCENARIO A/B — distributed + concentrated pre-kickoff arrival
// ============================================================
async function scenarioDistributed(sportCode: string, totalEntrants: number, concentrationPct: number, windowSec: number, maxConcurrency: number) {
  const mark = `qa-load-dist-${sportCode}-${Date.now()}`;
  console.log(`\n=== SCENARIO A/B: distributed arrival — sport=${sportCode} total=${totalEntrants} concentration=${concentrationPct}% in final window, window=${windowSec}s ===`);
  const fixture = await createLoadTestRound(sportCode, mark);
  const users = await registerUsers(BASE_URL, mark, totalEntrants);
  const pack = await getOnePack();
  await fundWallets(users, pack.priceCents);

  const concentratedCount = Math.round(totalEntrants * (concentrationPct / 100));
  const spreadCount = totalEntrants - concentratedCount;
  const spreadRps = Math.max(1, spreadCount / (windowSec * 4)); // spread portion arrives leisurely across 4x the window
  const concentratedRps = Math.max(1, concentratedCount / windowSec);

  async function submit(i: number): Promise<TaskResult> {
    const u = users[i];
    return timedFetch(`${BASE_URL}/api/${sportCode}/rounds/${fixture.roundId}/enter-package`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${u.token}` },
      body: JSON.stringify({ packageId: pack.id, selectionsPerEntry: [allSelections(fixture)] }),
    });
  }

  console.log(`  phase 1/2 (spread ${spreadCount} entrants @ ~${spreadRps.toFixed(1)} req/s)...`);
  const spreadResult = spreadCount > 0 ? await runPaced(spreadCount, spreadRps, Math.min(maxConcurrency, 50), (i) => submit(i)) : null;
  console.log(`  phase 2/2 (concentrated ${concentratedCount} entrants @ ~${concentratedRps.toFixed(1)} req/s — the pre-kickoff rush)...`);
  const concentratedResult = concentratedCount > 0 ? await runPaced(concentratedCount, concentratedRps, maxConcurrency, (i) => submit(spreadCount + i)) : null;

  if (spreadResult) console.log(formatResult(`  distributed phase (spread)`, spreadResult));
  if (concentratedResult) console.log(formatResult(`  distributed phase (concentrated pre-kickoff)`, concentratedResult));

  const entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, fixture.competitionId));
  const expectedSuccesses = (spreadResult?.succeeded ?? 0) + (concentratedResult?.succeeded ?? 0);
  console.log(`  financial integrity: entries=${entries.length} (expected ${expectedSuccesses}) -> ${entries.length === expectedSuccesses ? "PASS" : "FAIL — investigate"}`);

  await cleanupLoadTestFixture(fixture, users);
  return { spreadResult, concentratedResult };
}

// ============================================================
// SCENARIO H — settlement at scale
// ============================================================
/**
 * Thousands of entries across many customers and package sizes, settled under
 * concurrency. Exercises everything the product spec's Feature 6 asks for in one pass:
 * multiple identical-entry packages (1/5/10) creating multiple genuinely different shared
 * selection sets, a real mix of PERFECT and NOT PERFECT outcomes, prize-pool payout/winner
 * allocation, wallet prize credits, and settlement idempotency under CONCURRENT settle
 * calls (the real production risk — a retried request, a flaky client, or two admins
 * both clicking "settle" at once).
 */
/**
 * `db`/`BASE_URL` are PARAMETERS (defaulting to this file's normal module-level values —
 * every existing CLI call site is unaffected) so scripts/loadtest/run-isolated.ts can
 * inject a fully separate database + app server instance and reuse this EXACT scenario
 * unchanged — never a second, duplicated copy of the settlement-at-scale logic. Naming
 * them identically to the module-level `db`/`BASE_URL` means the function body below
 * (unchanged from the original single-environment version) transparently binds to
 * whichever was actually passed in, via ordinary JS parameter shadowing.
 */
export async function scenarioSettlement(sportCode: string, customerCount: number, db: AnyLoadTestDb = getDb(), BASE_URL: string = "http://localhost:3000") {
  const mark = `qa-load-settle-${sportCode}-${Date.now()}`;
  console.log(`\n=== SCENARIO H: settlement at scale — sport=${sportCode} customers=${customerCount} ===`);
  const fixture = await createLoadTestRound(sportCode, mark, db);
  // A conservative registration batch size — this sandbox's Neon HTTP endpoint has shown
  // transient "temporarily unavailable" errors under the default batchSize=50 concurrent
  // connections even for plain user registration, well before the interesting part of
  // this scenario even begins.
  const users = await registerUsers(BASE_URL, mark, customerCount, 15);
  const packages: (typeof schema.entryPackages.$inferSelect)[] = await db.select().from(schema.entryPackages).where(eq(schema.entryPackages.active, true));
  const packageBySize = new Map(packages.map((p) => [p.entryCount, p]));

  // Real, eligible admin account to drive close/settle through the actual HTTP API —
  // never a direct data-layer call, so this also exercises the real auth boundary.
  const adminEmail = `${mark}-admin@example.com`;
  const adminReg = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password: "qa-loadtest-admin-pw-123", name: "Settlement Admin" }),
  });
  const adminBody = await adminReg.json();
  const adminToken = adminBody.data.token as string;
  await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.email, adminEmail));

  // A second, REAL eligible-but-never-scoring player on the last game's away team —
  // createLoadTestRound only inserts one lineup row per game (the scorer), and picking a
  // nonexistent playerId would fail server-side eligibility VALIDATION (422) rather than
  // settling as a genuine incorrect pick, which is not what "not perfect" should test here.
  const lastGame = fixture.games[fixture.games.length - 1];
  const [lastGameRow] = await db.select().from(schema.games).where(eq(schema.games.id, lastGame.id)).limit(1);
  const [nonScoringPlayer] = await db
    .insert(schema.players)
    .values({ sportId: (await db.select().from(schema.sports).where(eq(schema.sports.code, sportCode)).limit(1))[0].id, teamId: lastGameRow.awayTeamId, firstName: mark, lastName: "NonScorer", position: "Any" })
    .returning();
  await db.insert(schema.gameLineups).values({ gameId: lastGame.id, playerId: nonScoringPlayer.id, teamId: lastGameRow.awayTeamId, position: "Any" });

  // Roughly 1 in 8 customers goes PERFECT (real, correct picks); everyone else picks the
  // real, eligible, but non-scoring player in the LAST game (a genuine incorrect pick) —
  // a real mix, never every entry trivially winning. Package size cycles 1/5/10 so every
  // purchase creates a genuinely different multi-entry, shared-selection-set purchase.
  const packageSizes = [1, 5, 10];
  const correctSelections = fixture.games.map((g) => ({ gameId: g.id, playerIds: [g.scorerId] }));
  const wrongLastGameSelections = fixture.games.map((g, i) => ({
    gameId: g.id,
    playerIds: i === fixture.games.length - 1 ? [nonScoringPlayer.id] : [g.scorerId],
  }));

  // Wallets are funded UP FRONT, sequentially, before the concurrent burst — matching
  // every other scenario's fundWallets convention (see scenarioBurst/scenarioMixed
  // above). Mixing a DB write into each concurrent task would (a) mean the "load" being
  // measured isn't purely the purchase endpoint, and (b) means one transient DB hiccup
  // under concurrency throws out of Promise.all and takes the whole run down instead of
  // being recorded as a single failed request by the harness's own error handling.
  let expectedPerfectEntries = 0;
  let expectedNotPerfectEntries = 0;
  const isWinnerByIndex: boolean[] = [];
  const sizeByIndex: number[] = [];
  for (let i = 0; i < users.length; i++) {
    const size = packageSizes[i % packageSizes.length];
    const isWinner = i % 8 === 0;
    sizeByIndex.push(size);
    isWinnerByIndex.push(isWinner);
    if (isWinner) expectedPerfectEntries += size;
    else expectedNotPerfectEntries += size;
  }
  // A single multi-row upsert per chunk, not one round-trip per customer — at load-test
  // scale (thousands of customers) the dominant cost in this sandbox is per-connection
  // network latency to a network-distant database (see harness.ts's withRetry doc
  // comment), not query cost, so batching round-trips is the real lever. Still an upsert
  // (ON CONFLICT DO UPDATE) targeting exactly the same rows/values a per-row loop would.
  const WALLET_FUND_CHUNK = 200;
  const walletRows = users.map((u, i) => ({ userId: u.userId, balanceCents: packageBySize.get(sizeByIndex[i])!.priceCents }));
  for (let start = 0; start < walletRows.length; start += WALLET_FUND_CHUNK) {
    const chunk = walletRows.slice(start, start + WALLET_FUND_CHUNK);
    await withRetry(() =>
      db
        .insert(schema.wallets)
        .values(chunk)
        .onConflictDoUpdate({ target: schema.wallets.userId, set: { balanceCents: sql`excluded.balance_cents` } }),
    );
  }

  const buy = async (i: number): Promise<TaskResult> => {
    const u = users[i];
    const pkg = packageBySize.get(sizeByIndex[i])!;
    const isWinner = isWinnerByIndex[i];
    return timedFetch(`${BASE_URL}/api/${sportCode}/rounds/${fixture.roundId}/enter-package`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${u.token}` },
      body: JSON.stringify({ packageId: pkg.id, selections: isWinner ? correctSelections : wrongLastGameSelections, idempotencyKey: `${mark}-${u.userId}` }),
    });
  };

  const purchaseResult = await runConcurrent(users.length, Math.min(15, users.length), buy);
  console.log(formatResult(`settlement-scale purchases`, purchaseResult));
  console.log(`  expected entries: ${expectedPerfectEntries + expectedNotPerfectEntries} (perfect=${expectedPerfectEntries}, not_perfect=${expectedNotPerfectEntries})`);

  // Finalize every game: real stat rows only for the scorer, on every game — the "wrong
  // last game" customers still miss because their SELECTED player differs from the real
  // scorer for that one game, never because the game itself is faked as unplayed.
  for (const g of fixture.games) {
    const [game] = await db.select().from(schema.games).where(eq(schema.games.id, g.id)).limit(1);
    await db.update(schema.games).set({ status: "final", homeScore: 18, awayScore: 12 }).where(eq(schema.games.id, g.id));
    await db.insert(schema.playerGameStats).values({ gameId: g.id, playerId: g.scorerId, teamId: game.homeTeamId, tries: 1, goals: 1, points: 30, touchdowns: 1 });
  }

  await fetch(`${BASE_URL}/api/admin/competitions/${fixture.competitionId}/close`, { method: "POST", headers: { Authorization: `Bearer ${adminToken}` } });

  // The actual concurrency test: several truly simultaneous "settle" calls (e.g. two
  // admins both clicking settle at once, or one admin's double-click/retried request) —
  // the real risk being tested is duplicate prize credits, duplicate moments, or a
  // corrupted winner count, never a partial/half-settled state. Deliberately a MODEST
  // concurrency (not dozens-way) — settleCompetition does one sequential Neon round-trip
  // per entry with no batching, so a very high fan-out mostly stress-tests this sandboxed
  // Neon HTTP endpoint's own connection/rate limits rather than the settlement logic
  // itself; a realistic number of simultaneous admin actions is what actually matters here.
  const settleConcurrency = 4;
  const settleResult = await runConcurrent(settleConcurrency, settleConcurrency, () =>
    timedFetch(`${BASE_URL}/api/admin/competitions/${fixture.competitionId}/settle`, { method: "POST", headers: { Authorization: `Bearer ${adminToken}` } }),
  );
  console.log(formatResult(`concurrent settle x${settleConcurrency}`, settleResult));

  // Settlement is explicitly documented (settlement.ts) as SAFE AND EXPECTED TO BE
  // RETRIED if a transient failure (a network blip, a saturated DB endpoint) stops it
  // partway through — "the normal admin reaction to seeing a failure... actually
  // finishes the incomplete work." Encode that real recovery path here rather than
  // assuming a single wave of concurrent calls must fully converge by itself.
  for (let attempt = 0; attempt < 5; attempt++) {
    const checkRows = await db.select().from(schema.competitions).where(eq(schema.competitions.id, fixture.competitionId)).limit(1);
    if (checkRows[0]?.prizeSettledAt) break;
    console.log(`  settlement did not converge yet — retry attempt ${attempt + 1}/5`);
    await timedFetch(`${BASE_URL}/api/admin/competitions/${fixture.competitionId}/settle`, { method: "POST", headers: { Authorization: `Bearer ${adminToken}` } });
  }

  const entries: (typeof schema.competitionEntries.$inferSelect)[] = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, fixture.competitionId));
  const perfectEntries = entries.filter((e) => e.result === "perfect");
  const notPerfectEntries = entries.filter((e) => e.result === "not_perfect");
  const winningCredits: (typeof schema.walletTransactions.$inferSelect)[] = await db.select().from(schema.walletTransactions).where(eq(schema.walletTransactions.type, "winning_credit"));
  const relevantCredits = winningCredits.filter((c) => perfectEntries.some((e) => e.id === c.relatedPrizeEntryId));
  const competitionRows: (typeof schema.competitions.$inferSelect)[] = await db.select().from(schema.competitions).where(eq(schema.competitions.id, fixture.competitionId));
  const competition = competitionRows[0];
  const moments: (typeof schema.perfectPlayMoments.$inferSelect)[] = await db.select().from(schema.perfectPlayMoments).where(eq(schema.perfectPlayMoments.competitionId, fixture.competitionId));
  const perfectMoments = moments.filter((m) => m.type === "perfect");
  const prizeWonMoments = moments.filter((m) => m.type === "prize_won");
  const distinctPerfectCustomers = new Set(perfectEntries.map((e) => e.userId)).size;

  console.log(`  entries: total=${entries.length} perfect=${perfectEntries.length} not_perfect=${notPerfectEntries.length}`);
  console.log(`  wallet: winning_credit rows=${relevantCredits.length} (expect exactly one per PERFECT ENTRY, never per customer)`);
  console.log(`  competition: winnerCount=${competition.winnerCount} awardedAmountCents=${competition.awardedAmountCents}`);
  console.log(`  moments: perfect=${perfectMoments.length} (expect one per PERFECT CUSTOMER) prize_won=${prizeWonMoments.length}`);

  const checks = {
    entryCountMatchesExpected: entries.length === expectedPerfectEntries + expectedNotPerfectEntries,
    perfectCountMatchesExpected: perfectEntries.length === expectedPerfectEntries,
    notPerfectCountMatchesExpected: notPerfectEntries.length === expectedNotPerfectEntries,
    oneWinningCreditPerPerfectEntry: relevantCredits.length === perfectEntries.length,
    winnerCountMatchesEntries: competition.winnerCount === perfectEntries.length, // entries determine winnerCount, never deduplicated to unique customers
    awardedAmountSumsToCredits: competition.awardedAmountCents === relevantCredits.reduce((sum, c) => sum + c.amountCents, 0),
    momentsDedupedToCustomersNotEntries: perfectMoments.length === distinctPerfectCustomers && prizeWonMoments.length === distinctPerfectCustomers,
    noRolloverSinceThereAreWinners: competition.rolloverOutCents === 0,
  };
  const allOk = Object.values(checks).every(Boolean);
  console.log(`  integrity checks: ${JSON.stringify(checks)}`);
  console.log(`  settlement-at-scale integrity: ${allOk ? "PASS" : "FAIL — investigate"}`);

  await db.delete(schema.perfectPlayMoments).where(eq(schema.perfectPlayMoments.competitionId, fixture.competitionId));
  await cleanupLoadTestFixture(fixture, users, db);
  await db.delete(schema.gameLineups).where(eq(schema.gameLineups.playerId, nonScoringPlayer.id));
  await db.delete(schema.players).where(eq(schema.players.id, nonScoringPlayer.id));
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, adminBody.data.user.id));
  await db.delete(schema.users).where(eq(schema.users.id, adminBody.data.user.id));

  return { purchaseResult, settleResult, checks, allOk };
}

async function main() {
  // Warm up the DB connection before the real run — this sandbox's very first outbound
  // connection in a freshly-started process has shown a real chance of exceeding the
  // driver's connection-establishment timeout (observed directly: identical, isolated,
  // zero-concurrency queries succeed in 200-1000ms on every call AFTER the first). This
  // absorbs that one-time cold-start cost outside of anything being measured/tested.
  try {
    await db.select().from(schema.sports).limit(1);
  } catch {
    // A failure here just means the warm-up itself hit the cold-start timeout — the real
    // run below will simply pay that cost instead. Never fatal.
  }

  const [, , scenario, sportArg, nArg, cArg] = process.argv;
  const sportCode = sportArg ?? "nrl";
  const n = nArg ? Number(nArg) : 100;
  const concurrency = cArg ? Number(cArg) : 25;

  switch (scenario) {
    case "burst":
      await scenarioBurst(sportCode, n, concurrency);
      break;
    case "duplicate":
      await scenarioDuplicate(sportCode, n || concurrency);
      break;
    case "cutoff":
      await scenarioCutoff(sportCode);
      break;
    case "reads":
      await scenarioReads(sportCode, n, concurrency);
      break;
    case "mixed":
      await scenarioMixed(sportCode, n, concurrency);
      break;
    case "distributed": {
      const concentration = cArg ? Number(cArg) : 40;
      const windowSec = 20;
      await scenarioDistributed(sportCode, n, concentration, windowSec, 50);
      break;
    }
    case "settlement": {
      const customerCount = nArg ? Number(nArg) : 300; // 300 customers x avg ~5-entry package ≈ ~1500 entries
      const result = await scenarioSettlement(sportCode, customerCount);
      if (!result.allOk) process.exitCode = 1;
      break;
    }
    default:
      console.log("Usage: run.ts <burst|duplicate|cutoff|reads|mixed|distributed|settlement> [sport] [n] [concurrency|concentrationPct]");
      process.exit(1);
  }
}

// Only run the CLI entry point when this file is executed directly (`tsx run.ts ...`) —
// never when another script (e.g. run-isolated.ts) imports scenarioSettlement from it,
// which would otherwise re-parse THAT script's own argv and hit the `default:` usage
// case's process.exit(1) before the import even finishes.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
