/**
 * QA — production scheduler (Feature: Vercel Cron -> POST /api/admin/notifications/tick).
 * Cron-secret auth itself is unit-tested (src/lib/auth/cron.test.ts); this script drives
 * the REAL HTTP endpoint against REAL fixtures to verify the actual scheduled-job
 * behaviour: idempotency across repeated ticks, closed/settled competitions never getting
 * further reminders, no fake "team lists ready" when the data genuinely isn't there, and
 * multiple competitions being processed independently of each other.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/qa-scheduler.ts
 */
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../src/db";
import type { MomentType } from "../src/db/schema";
import { createLoadTestRound, cleanupLoadTestFixture, type LoadTestRoundFixture, type LoadTestUser } from "./loadtest/fixtures";
import { closeCompetition } from "../src/lib/data/competitions";
import { settleCompetition } from "../src/lib/data/settlement";

const db = getDb();
const API_URL = "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET;
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

async function tick(): Promise<{ status: number; body: { ok: boolean; data?: { competitionsChecked: number; results: { competitionId: number; entryMarketOpen: number; teamListsAvailable: number; closingReminders: number }[] } } }> {
  const res = await fetch(`${API_URL}/api/admin/notifications/tick`, { method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` } });
  return { status: res.status, body: await res.json() };
}

async function addFullTeamLists(fixture: LoadTestRoundFixture, mark: string): Promise<number[]> {
  const extraPlayerIds: number[] = [];
  for (const g of fixture.games) {
    const [game] = await db.select().from(schema.games).where(eq(schema.games.id, g.id)).limit(1);
    const [player] = await db
      .insert(schema.players)
      .values({ sportId: (await db.select().from(schema.sports).where(eq(schema.sports.code, fixture.sportCode)).limit(1))[0].id, teamId: game.awayTeamId, firstName: mark, lastName: `Away${g.id}`, position: "Any" })
      .returning();
    await db.insert(schema.gameLineups).values({ gameId: g.id, playerId: player.id, teamId: game.awayTeamId, position: "Any" });
    extraPlayerIds.push(player.id);
  }
  return extraPlayerIds;
}

async function eventsFor(competitionId: number, type: MomentType) {
  return db.select().from(schema.perfectPlayMoments).where(and(eq(schema.perfectPlayMoments.competitionId, competitionId), eq(schema.perfectPlayMoments.type, type)));
}

async function main() {
  if (!CRON_SECRET) throw new Error("CRON_SECRET must be set in the environment to run this QA script.");

  console.log("=== Scheduler auth sanity (formal unit coverage lives in src/lib/auth/cron.test.ts) ===");
  const badAuthRes = await fetch(`${API_URL}/api/admin/notifications/tick`, { method: "POST", headers: { Authorization: "Bearer definitely-wrong" } });
  check("invalid cron secret rejected with 401", badAuthRes.status === 401, { status: badAuthRes.status });
  const noAuthRes = await fetch(`${API_URL}/api/admin/notifications/tick`, { method: "POST" });
  check("missing auth rejected with 401", noAuthRes.status === 401, { status: noAuthRes.status });

  console.log("\n=== Multiple competitions processed independently, real team lists, idempotent across repeated ticks ===");
  const markA = `qa-sched-a-${Date.now()}`;
  const markB = `qa-sched-b-${Date.now()}`;
  const fixtureA = await createLoadTestRound("nrl", markA);
  const fixtureB = await createLoadTestRound("afl", markB);
  const extraA = await addFullTeamLists(fixtureA, markA);
  const extraB = await addFullTeamLists(fixtureB, markB);
  const userA = await (await fetch(`${API_URL}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${markA}@example.com`, password: "qa-sched-pw-123", name: "Sched QA A" }) })).json();

  const firstTick = await tick();
  check("scheduler executes successfully (200 OK)", firstTick.status === 200 && firstTick.body.ok === true, firstTick);
  const resultA1 = firstTick.body.data!.results.find((r) => r.competitionId === fixtureA.competitionId);
  const resultB1 = firstTick.body.data!.results.find((r) => r.competitionId === fixtureB.competitionId);
  check("competition A got its own entry_market_open + team_lists_available events", (resultA1?.entryMarketOpen ?? 0) > 0 && (resultA1?.teamListsAvailable ?? 0) > 0, resultA1);
  check("competition B got its own entry_market_open + team_lists_available events, independent of A", (resultB1?.entryMarketOpen ?? 0) > 0 && (resultB1?.teamListsAvailable ?? 0) > 0, resultB1);

  const marketOpenA1 = await eventsFor(fixtureA.competitionId, "entry_market_open");
  const marketOpenB1 = await eventsFor(fixtureB.competitionId, "entry_market_open");

  const secondTick = await tick();
  const resultA2 = secondTick.body.data!.results.find((r) => r.competitionId === fixtureA.competitionId);
  const resultB2 = secondTick.body.data!.results.find((r) => r.competitionId === fixtureB.competitionId);
  check("running the scheduler twice creates ZERO new events for A (idempotent)", resultA2?.entryMarketOpen === 0 && resultA2?.teamListsAvailable === 0, resultA2);
  check("running the scheduler twice creates ZERO new events for B (idempotent)", resultB2?.entryMarketOpen === 0 && resultB2?.teamListsAvailable === 0, resultB2);
  const marketOpenA2 = await eventsFor(fixtureA.competitionId, "entry_market_open");
  check("row count for A unchanged after the second tick", marketOpenA2.length === marketOpenA1.length, { before: marketOpenA1.length, after: marketOpenA2.length });

  console.log("\n=== Closed competition stops further reminders ===");
  await closeCompetition(fixtureA.competitionId);
  const cutoffAt = new Date(Date.now() + 8 * 60_000);
  await db.update(schema.games).set({ kickoff: cutoffAt }).where(eq(schema.games.id, fixtureA.games[0].id));
  const afterCloseTick = await tick();
  const resultAClosed = afterCloseTick.body.data!.results.find((r) => r.competitionId === fixtureA.competitionId);
  check("a closed competition is not even in the scan, or generates zero further reminders", !resultAClosed || resultAClosed.closingReminders === 0);
  const closingEventsA = await eventsFor(fixtureA.competitionId, "entry_closing_soon");
  check("no closing-soon reminder was ever created for the closed competition", closingEventsA.length === 0, closingEventsA);

  console.log("\n=== Already-settled competition generates no entry reminders ===");
  // Finalize B's games and settle it, then confirm the scheduler ignores it entirely from then on.
  for (const g of fixtureB.games) {
    const [game] = await db.select().from(schema.games).where(eq(schema.games.id, g.id)).limit(1);
    await db.update(schema.games).set({ status: "final", homeScore: 10, awayScore: 8 }).where(eq(schema.games.id, g.id));
    await db.insert(schema.playerGameStats).values({ gameId: g.id, playerId: g.scorerId, teamId: game.homeTeamId, goals: 1 });
  }
  await closeCompetition(fixtureB.competitionId);
  await settleCompetition(fixtureB.competitionId);
  const afterSettleTick = await tick();
  const resultBSettled = afterSettleTick.body.data!.results.find((r) => r.competitionId === fixtureB.competitionId);
  check("a settled competition is excluded from the scheduler's scan entirely", !resultBSettled, { found: resultBSettled });

  console.log("\n=== No eligible team-list data -> no fake 'team lists ready' notification ===");
  const markC = `qa-sched-c-${Date.now()}`;
  const fixtureC = await createLoadTestRound("nba", markC);
  // Deliberately do NOT add a second lineup player per game — createLoadTestRound's
  // single-lineup-row-per-game fixture never satisfies teamListsReady (needs >=2, see
  // readiness.ts's INCOMPLETE_GAME_PLAYER_DATA blocker) — this must never be faked around.
  const tickC = await tick();
  const resultC = tickC.body.data!.results.find((r) => r.competitionId === fixtureC.competitionId);
  check("no entry_market_open fires without real, complete team-list data", (resultC?.entryMarketOpen ?? 0) === 0, resultC);
  check("no team_lists_available fires without real, complete team-list data", (resultC?.teamListsAvailable ?? 0) === 0, resultC);
  const fakeReadyEvents = await eventsFor(fixtureC.competitionId, "team_lists_available");
  check("zero team_lists_available rows exist for the incomplete-data competition", fakeReadyEvents.length === 0, fakeReadyEvents);

  // Cleanup
  await db.delete(schema.perfectPlayMoments).where(eq(schema.perfectPlayMoments.competitionId, fixtureA.competitionId));
  await db.delete(schema.perfectPlayMoments).where(eq(schema.perfectPlayMoments.competitionId, fixtureB.competitionId));
  await db.delete(schema.perfectPlayMoments).where(eq(schema.perfectPlayMoments.competitionId, fixtureC.competitionId));
  await cleanupLoadTestFixture(fixtureA, userA.ok ? [{ userId: userA.data.user.id, token: userA.data.token, email: `${markA}@example.com` } as LoadTestUser] : []);
  await cleanupLoadTestFixture(fixtureB, []);
  await cleanupLoadTestFixture(fixtureC, []);
  for (const id of [...extraA, ...extraB]) await db.delete(schema.players).where(eq(schema.players.id, id));

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
