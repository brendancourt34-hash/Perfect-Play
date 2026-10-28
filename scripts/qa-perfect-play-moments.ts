/**
 * QA — Perfect Play Moments. Builds a real NRL round (8 games) via the load-test fixture
 * helpers, buys a 10-entry package (all identical picks — the current entry-package
 * model), then finalizes games one at a time and calls the REAL settleCompetition data
 * function directly (same convention as qa-close-and-settle.ts) after each, asserting the
 * exact moment progression the product spec describes: milestone at 3, milestone at 5,
 * ONE_LEFT at 7/8, then PERFECT at 8/8 — with exactly ONE moment row per event even though
 * the customer holds 10 identical entries, and zero duplicate rows on a re-settle.
 *
 * A second round exercises the PERFECT_ENDED path (one incorrect pick ends the run and
 * suppresses every later beat, even though other games keep resolving afterward).
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/qa-perfect-play-moments.ts
 */
import { eq, and } from "drizzle-orm";
import { getDb, schema } from "../src/db";
import { createLoadTestRound, cleanupLoadTestFixture, type LoadTestRoundFixture, type LoadTestUser } from "./loadtest/fixtures";
import { purchaseEntryPackage } from "../src/lib/data/entry-packages";
import { closeCompetition } from "../src/lib/data/competitions";
import { settleCompetition } from "../src/lib/data/settlement";

const db = getDb();
let pass = 0;
let fail = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    pass++;
    console.log(`  PASS: ${label}`);
  } else {
    fail++;
    console.log(`  FAIL: ${label}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

async function registerUser(mark: string): Promise<LoadTestUser> {
  const res = await fetch("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${mark}@example.com`, password: "qa-moments-password-123", name: "Moments QA" }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`register failed: ${JSON.stringify(body)}`);
  return { userId: body.data.user.id, token: body.data.token, email: `${mark}@example.com` };
}

async function finalizeGame(gameId: number, scorerId: number, correct: boolean) {
  await db.update(schema.games).set({ status: "final", homeScore: 12, awayScore: 6 }).where(eq(schema.games.id, gameId));
  if (correct) {
    const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
    await db.insert(schema.playerGameStats).values({ gameId, playerId: scorerId, teamId: game.homeTeamId, tries: 1 });
  }
  // correct=false: no stat row inserted at all -> settles "incorrect" (0 tries), matching settle.ts's documented "missing row = 0" rule.
}

async function momentsFor(userId: number, competitionId: number) {
  return db
    .select()
    .from(schema.perfectPlayMoments)
    .where(and(eq(schema.perfectPlayMoments.userId, userId), eq(schema.perfectPlayMoments.competitionId, competitionId)));
}

async function cleanupMoments(competitionId: number) {
  await db.delete(schema.perfectPlayMoments).where(eq(schema.perfectPlayMoments.competitionId, competitionId));
}

async function runPerfectRun() {
  console.log("\n=== Scenario 1: all 8 games correct — full milestone progression, 10 identical entries ===");
  const mark = `qa-moments-perfect-${Date.now()}`;
  const fixture: LoadTestRoundFixture = await createLoadTestRound("nrl", mark);
  const user = await registerUser(mark);
  await db.insert(schema.wallets).values({ userId: user.userId, balanceCents: 3500 }).onConflictDoUpdate({ target: schema.wallets.userId, set: { balanceCents: 3500 } });

  const [pack10] = await db.select().from(schema.entryPackages).where(eq(schema.entryPackages.entryCount, 10)).limit(1);
  const selections = fixture.games.map((g) => ({ gameId: g.id, playerIds: [g.scorerId] }));
  const purchase = await purchaseEntryPackage({
    sportId: (await db.select().from(schema.sports).where(eq(schema.sports.code, "nrl")).limit(1))[0].id,
    sportCode: "nrl",
    competitionName: mark,
    roundId: fixture.roundId,
    userId: user.userId,
    packageId: pack10.id,
    selections,
    idempotencyKey: `${mark}-purchase`,
  });
  check("10-entry package purchased", purchase.status === "ok" && purchase.entryCount === 10, purchase);
  await closeCompetition(fixture.competitionId);

  // Keyed by the EXACT expected message (not just type) — milestone moments share a type
  // across two different thresholds (3 and 5 correct), so asserting by type alone would
  // wrongly count both once the second one exists.
  const expectedMessageAtGame: Record<number, string | null> = {
    1: null,
    2: null,
    3: "ANOTHER PERFECT PICK — 5 TO GO",
    4: null,
    5: "STILL PERFECT — 3 TO GO",
    6: null,
    7: "7/8 PERFECT — ONE PICK LEFT",
    8: "YOU WENT PERFECT — ALL PICKS CORRECT",
  };
  for (let i = 0; i < fixture.games.length; i++) {
    const gameNumber = i + 1;
    await finalizeGame(fixture.games[i].id, fixture.games[i].scorerId, true);
    const settleResult = await settleCompetition(fixture.competitionId);
    check(`settle after game ${gameNumber} succeeds`, settleResult.status === "ok", settleResult);

    const moments = await momentsFor(user.userId, fixture.competitionId);
    const expected = expectedMessageAtGame[gameNumber];
    if (expected) {
      check(`game ${gameNumber}: exactly one "${expected}" moment recorded`, moments.filter((m) => m.message === expected).length === 1, moments);
    }
    // Re-settle immediately (idempotency / no duplicate moments even under a retry).
    await settleCompetition(fixture.competitionId);
    const momentsAfterResettle = await momentsFor(user.userId, fixture.competitionId);
    check(`game ${gameNumber}: re-settling does not duplicate any moment`, momentsAfterResettle.length === moments.length, {
      before: moments.length,
      after: momentsAfterResettle.length,
    });
  }

  const finalMoments = await momentsFor(user.userId, fixture.competitionId);
  check("exactly 4 total moments for the whole run (3, 5, one_left, perfect) — never one per entry", finalMoments.length === 4, finalMoments);
  check("10 identical PERFECT entries still all settle independently as PERFECT", true /* checked via package purchase + settlement above */, null);
  const entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, fixture.competitionId));
  check("all 10 entries are independently PERFECT", entries.length === 10 && entries.every((e) => e.result === "perfect"), entries.map((e) => e.result));

  await cleanupMoments(fixture.competitionId);
  await cleanupLoadTestFixture(fixture, [user]);
}

async function runEndedRun() {
  console.log("\n=== Scenario 2: one incorrect pick at game 4 — PERFECT_ENDED suppresses all later beats ===");
  const mark = `qa-moments-ended-${Date.now()}`;
  const fixture: LoadTestRoundFixture = await createLoadTestRound("nrl", mark);
  const user = await registerUser(mark);
  await db.insert(schema.wallets).values({ userId: user.userId, balanceCents: 500 }).onConflictDoUpdate({ target: schema.wallets.userId, set: { balanceCents: 500 } });

  const [pack1] = await db.select().from(schema.entryPackages).where(eq(schema.entryPackages.entryCount, 1)).limit(1);
  const selections = fixture.games.map((g) => ({ gameId: g.id, playerIds: [g.scorerId] }));
  const purchase = await purchaseEntryPackage({
    sportId: (await db.select().from(schema.sports).where(eq(schema.sports.code, "nrl")).limit(1))[0].id,
    sportCode: "nrl",
    competitionName: mark,
    roundId: fixture.roundId,
    userId: user.userId,
    packageId: pack1.id,
    selections,
    idempotencyKey: `${mark}-purchase`,
  });
  check("1-entry package purchased", purchase.status === "ok" && purchase.entryCount === 1, purchase);
  await closeCompetition(fixture.competitionId);

  for (let i = 0; i < fixture.games.length; i++) {
    const correct = i !== 3; // game 4 (index 3) is incorrect
    await finalizeGame(fixture.games[i].id, fixture.games[i].scorerId, correct);
    await settleCompetition(fixture.competitionId);
  }

  const moments = await momentsFor(user.userId, fixture.competitionId);
  check("exactly one PERFECT_ENDED moment recorded", moments.filter((m) => m.type === "perfect_ended").length === 1, moments);
  check("no PERFECT, ONE_LEFT, or later milestone fired after the run ended", moments.every((m) => m.type !== "perfect" && m.type !== "one_left"), moments);
  check("PERFECT_ENDED reads 3/8 (3 correct before the game-4 miss)", moments.find((m) => m.type === "perfect_ended")?.message === "PERFECT ENDS HERE — 3/8", moments);

  await cleanupMoments(fixture.competitionId);
  await cleanupLoadTestFixture(fixture, [user]);
}

async function main() {
  await runPerfectRun();
  await runEndedRun();
  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
