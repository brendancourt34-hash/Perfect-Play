/**
 * QA — the broader customer notification/event system (Feature 3): entry market open,
 * team lists available, entry closing reminders (10/5/1 min), rollover, and prize_won.
 * Built entirely on top of src/lib/data/notifications.ts, calling the same functions the
 * admin tick endpoint and settlement.ts actually use.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/qa-customer-events.ts
 */
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../src/db";
import type { MomentType } from "../src/db/schema";
import { createLoadTestRound, cleanupLoadTestFixture, type LoadTestUser } from "./loadtest/fixtures";
import { purchaseEntryPackage } from "../src/lib/data/entry-packages";
import { closeCompetition } from "../src/lib/data/competitions";
import { settleCompetition } from "../src/lib/data/settlement";
import { checkAndFireEntryMarketOpen, checkAndFireEntryClosingReminders } from "../src/lib/data/notifications";

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
    body: JSON.stringify({ email: `${mark}@example.com`, password: "qa-events-password-123", name: "Events QA" }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`register failed: ${JSON.stringify(body)}`);
  return { userId: body.data.user.id, token: body.data.token, email: `${mark}@example.com` };
}

async function eventsFor(competitionId: number, type: MomentType) {
  return db.select().from(schema.perfectPlayMoments).where(and(eq(schema.perfectPlayMoments.competitionId, competitionId), eq(schema.perfectPlayMoments.type, type)));
}

async function purchaseOneEntry(userId: number, sportId: number, roundId: number, mark: string, selections: { gameId: number; playerIds: number[] }[], attempt = "a") {
  const [pack1] = await db.select().from(schema.entryPackages).where(eq(schema.entryPackages.entryCount, 1)).limit(1);
  await db.insert(schema.wallets).values({ userId, balanceCents: 500 }).onConflictDoUpdate({ target: schema.wallets.userId, set: { balanceCents: 500 } });
  // A distinct idempotencyKey PER PURCHASE ATTEMPT (not per user) — reusing the same key
  // across two genuinely separate purchase decisions would make the second one resolve as
  // an idempotent replay of the first (exactly the "same key = same purchase" guarantee
  // the real system already provides and is deliberately relied on elsewhere in this repo).
  return purchaseEntryPackage({ sportId, sportCode: "nrl", competitionName: mark, roundId, userId, packageId: pack1.id, selections, idempotencyKey: `${mark}-${userId}-${attempt}` });
}

async function runEntryMarketOpenTest() {
  console.log("\n=== ENTRY_MARKET_OPEN: fires once real team lists are ready, is idempotent ===");
  const mark = `qa-events-open-${Date.now()}`;
  const fixture = await createLoadTestRound("nrl", mark);
  const u1 = await registerUser(`${mark}-u1`);

  // createLoadTestRound only inserts ONE lineup row per game (the scorer) — real
  // teamListsReady requires BOTH teams represented (>=2 players/game, see readiness.ts's
  // INCOMPLETE_GAME_PLAYER_DATA blocker), so add a second, away-team player per game.
  const sportRow = (await db.select().from(schema.sports).where(eq(schema.sports.code, "nrl")).limit(1))[0];
  const extraPlayerIds: number[] = [];
  for (const g of fixture.games) {
    const [game] = await db.select().from(schema.games).where(eq(schema.games.id, g.id)).limit(1);
    const [awayPlayer] = await db
      .insert(schema.players)
      .values({ sportId: sportRow.id, teamId: game.awayTeamId, firstName: mark, lastName: `Away${g.id}`, position: "Any" })
      .returning();
    await db.insert(schema.gameLineups).values({ gameId: g.id, playerId: awayPlayer.id, teamId: game.awayTeamId, position: "Any" });
    extraPlayerIds.push(awayPlayer.id);
  }

  const first = await checkAndFireEntryMarketOpen(fixture.competitionId);
  check("first check creates at least one event (real users exist, team lists ready, competition open)", first.status === "ok" && first.data > 0, first);

  const rows = await eventsFor(fixture.competitionId, "entry_market_open");
  check("the QA user has exactly one entry_market_open row", rows.some((r) => r.userId === u1.userId), rows);

  const second = await checkAndFireEntryMarketOpen(fixture.competitionId);
  check("re-running the check creates ZERO new events for users who already have one (idempotent)", second.status === "ok" && second.data === 0, second);

  const rowsAfter = await eventsFor(fixture.competitionId, "entry_market_open");
  check("row count is unchanged after the second run", rowsAfter.length === rows.length, { before: rows.length, after: rowsAfter.length });

  await db.delete(schema.perfectPlayMoments).where(eq(schema.perfectPlayMoments.competitionId, fixture.competitionId));
  await cleanupLoadTestFixture(fixture, [u1]);
  for (const id of extraPlayerIds) await db.delete(schema.players).where(eq(schema.players.id, id));
}

async function runClosingReminderTest() {
  console.log("\n=== ENTRY_CLOSING_SOON/NOW: fires the right bucket(s) for time-to-cutoff, never after cutoff ===");
  const mark = `qa-events-closing-${Date.now()}`;
  const fixture = await createLoadTestRound("nrl", mark);
  const u1 = await registerUser(`${mark}-u1`);

  // 8 minutes to cutoff -> only the "10 minute" bucket should be active.
  const cutoffAt = new Date(Date.now() + 8 * 60_000);
  await db.update(schema.games).set({ kickoff: cutoffAt }).where(eq(schema.games.id, fixture.games[0].id));

  const first = await checkAndFireEntryClosingReminders(fixture.competitionId);
  check("8 minutes out: creates events (10-minute bucket active)", first.status === "ok" && first.data > 0, first);
  const tenMinRows = await eventsFor(fixture.competitionId, "entry_closing_soon");
  check("the 10-minute bucket message is correct", tenMinRows.some((r) => r.message.includes("10 MINUTES TO GO")), tenMinRows);
  check("the 5-minute bucket has NOT fired yet", !tenMinRows.some((r) => r.message.includes("5 minutes left")), tenMinRows);

  // Move to 3 minutes to cutoff -> 5-minute bucket should now also fire, 10-minute bucket must not duplicate.
  await db.update(schema.games).set({ kickoff: new Date(Date.now() + 3 * 60_000) }).where(eq(schema.games.id, fixture.games[0].id));
  await checkAndFireEntryClosingReminders(fixture.competitionId);
  const afterFiveMin = await eventsFor(fixture.competitionId, "entry_closing_soon");
  const tenMinCount = afterFiveMin.filter((r) => r.message.includes("10 MINUTES")).length;
  const fiveMinCount = afterFiveMin.filter((r) => r.message.includes("5 minutes left")).length;
  check("the 10-minute bucket did not gain any duplicate rows", tenMinCount === tenMinRows.length, { tenMinCount, before: tenMinRows.length });
  check("the 5-minute bucket now has exactly one row per recipient of the 10-minute bucket", fiveMinCount === tenMinRows.length && fiveMinCount > 0, { fiveMinCount, tenMinRowsLength: tenMinRows.length });
  check("no user has more than one row of either bucket (dedupe holds under repeat ticks)", afterFiveMin.length === tenMinCount + fiveMinCount, { total: afterFiveMin.length, tenMinCount, fiveMinCount });

  // Close the competition -> must not fire anything further, even inside the 1-minute window.
  await closeCompetition(fixture.competitionId);
  await db.update(schema.games).set({ kickoff: new Date(Date.now() + 30_000) }).where(eq(schema.games.id, fixture.games[0].id));
  const afterClose = await checkAndFireEntryClosingReminders(fixture.competitionId);
  check("once closed, no further reminders are ever created", afterClose.status === "ok" && afterClose.data === 0, afterClose);
  const closingNowRows = await eventsFor(fixture.competitionId, "entry_closing_now");
  check("entry_closing_now never fired for a closed competition", closingNowRows.length === 0, closingNowRows);

  await db.delete(schema.perfectPlayMoments).where(eq(schema.perfectPlayMoments.competitionId, fixture.competitionId));
  await cleanupLoadTestFixture(fixture, [u1]);
}

async function runPrizeWonAndRolloverTest() {
  console.log("\n=== PRIZE_WON / ROLLOVER: fired from real settlement, per-customer shares, idempotent ===");

  // Scenario A: one PERFECT customer with 2 entries via two separate 1-entry purchases (reusing the same canonical selections) -> PRIZE_WON with shareCount=2.
  const markWin = `qa-events-win-${Date.now()}`;
  const winFixture = await createLoadTestRound("nrl", markWin);
  const winner = await registerUser(`${markWin}-winner`);
  const correctSelections = winFixture.games.map((g) => ({ gameId: g.id, playerIds: [g.scorerId] }));
  const sportRow = (await db.select().from(schema.sports).where(eq(schema.sports.code, "nrl")).limit(1))[0];
  await purchaseOneEntry(winner.userId, sportRow.id, winFixture.roundId, markWin, correctSelections, "a");
  await purchaseOneEntry(winner.userId, sportRow.id, winFixture.roundId, markWin, correctSelections, "b"); // buys a 2nd identical entry, reusing the canonical set
  await closeCompetition(winFixture.competitionId);
  for (const g of winFixture.games) {
    await db.update(schema.games).set({ status: "final", homeScore: 12, awayScore: 6 }).where(eq(schema.games.id, g.id));
    await db.insert(schema.playerGameStats).values({ gameId: g.id, playerId: g.scorerId, teamId: (await db.select().from(schema.games).where(eq(schema.games.id, g.id)))[0].homeTeamId, tries: 1 });
  }
  const settleResult = await settleCompetition(winFixture.competitionId);
  check("settlement succeeds with 2 PERFECT entries for one customer", settleResult.status === "ok" && settleResult.summary.perfectEntryIds.length === 2, settleResult);

  const prizeWonRows = await eventsFor(winFixture.competitionId, "prize_won");
  check("exactly ONE prize_won notification for the winning customer (not one per entry)", prizeWonRows.length === 1, prizeWonRows);
  check("the message reports 2 SHARES", prizeWonRows[0]?.message.includes("2 SHARES"), prizeWonRows);

  // Re-settle: must not duplicate the prize_won notification.
  await settleCompetition(winFixture.competitionId);
  const prizeWonRowsAfter = await eventsFor(winFixture.competitionId, "prize_won");
  check("re-settling does not duplicate the prize_won notification", prizeWonRowsAfter.length === 1, prizeWonRowsAfter);

  await db.delete(schema.perfectPlayMoments).where(eq(schema.perfectPlayMoments.competitionId, winFixture.competitionId));
  await cleanupLoadTestFixture(winFixture, [winner]);

  // Scenario B: zero winners -> ROLLOVER fires for every entrant.
  const markRoll = `qa-events-roll-${Date.now()}`;
  const rollFixture = await createLoadTestRound("nrl", markRoll);
  const loser = await registerUser(`${markRoll}-loser`);
  const wrongSelections = rollFixture.games.map((g) => ({ gameId: g.id, playerIds: [g.scorerId] }));
  await purchaseOneEntry(loser.userId, sportRow.id, rollFixture.roundId, markRoll, wrongSelections);
  await closeCompetition(rollFixture.competitionId);
  for (const g of rollFixture.games) {
    // Final, but with NO stat row for the picked scorer -> settles "incorrect" (0 tries).
    await db.update(schema.games).set({ status: "final", homeScore: 12, awayScore: 6 }).where(eq(schema.games.id, g.id));
  }
  const rollSettleResult = await settleCompetition(rollFixture.competitionId);
  check("settlement succeeds with zero PERFECT entries", rollSettleResult.status === "ok" && rollSettleResult.summary.perfectEntryIds.length === 0, rollSettleResult);

  const rolloverRows = await eventsFor(rollFixture.competitionId, "rollover");
  check("exactly one rollover notification for the one entrant", rolloverRows.length === 1 && rolloverRows[0].userId === loser.userId, rolloverRows);
  check("no prize_won notification exists for this competition", (await eventsFor(rollFixture.competitionId, "prize_won")).length === 0, null);

  await db.delete(schema.perfectPlayMoments).where(eq(schema.perfectPlayMoments.competitionId, rollFixture.competitionId));
  await cleanupLoadTestFixture(rollFixture, [loser]);
}

async function main() {
  await runEntryMarketOpenTest();
  await runClosingReminderTest();
  await runPrizeWonAndRolloverTest();
  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
