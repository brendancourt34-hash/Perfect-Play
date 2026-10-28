/**
 * PHASE 23H — settlement/rollover FAILURE RECOVERY. Proves the specific guarantee added
 * this audit: if a settle call's downstream work (crediting a winner's wallet, or pushing
 * rollover to the next competition) never completed the first time — a crash, a transient
 * DB error, anything short of the core prizeSettledAt commit itself — simply calling
 * settle again on the same competition actually finishes the incomplete work, rather than
 * taking a dead-end "already settled" branch forever (the bug this fixes) or double-
 * crediting/double-delivering on the retry (the bug a naive fix could introduce).
 *
 * Simulates the partial failure directly at the DB layer (writing exactly the state a
 * real partial failure would leave behind — prizeSettledAt/prizeAllocationCents set, but
 * no wallet_transactions/rolloverInCents delivered yet) rather than actually crashing the
 * server mid-request, since there's no clean way to inject a real fault into a live
 * process from outside it.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and } from "drizzle-orm";
import * as schema from "../src/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
const MARK = `qa23h-recover-${Date.now()}`;
const TEST_YEAR = 2400 + (Date.now() % 900);
const API = "http://localhost:3000";

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("PASS: " + msg);
  passed++;
}

async function main() {
  const [sport] = await db.select().from(schema.sports).where(eq(schema.sports.code, "nrl")).limit(1);
  const [season] = await db.insert(schema.seasons).values({ sportId: sport.id, year: TEST_YEAR, label: MARK }).returning();

  // --- Scenario A: a winner's credit never happened, simulating a crash right after the
  // atomic prizeSettledAt commit but before creditPrizeWinnings ran. Retrying settle must
  // actually credit the wallet. ---
  const [roundA] = await db.insert(schema.rounds).values({ seasonId: season.id, roundNumber: 1, name: `${MARK}-A` }).returning();
  const [teamA1] = await db.insert(schema.teams).values({ sportId: sport.id, slug: `${MARK}-a1`, name: "Rec A1", shortName: "RA1" }).returning();
  const [teamA2] = await db.insert(schema.teams).values({ sportId: sport.id, slug: `${MARK}-a2`, name: "Rec A2", shortName: "RA2" }).returning();
  const [gameA] = await db
    .insert(schema.games)
    .values({ roundId: roundA.id, homeTeamId: teamA1.id, awayTeamId: teamA2.id, kickoff: new Date(Date.now() + 3600_000), status: "scheduled" })
    .returning();
  const [scorerA] = await db.insert(schema.players).values({ sportId: sport.id, teamId: teamA1.id, firstName: MARK, lastName: "WinnerA", position: "Any" }).returning();
  await db.insert(schema.gameLineups).values({ gameId: gameA.id, playerId: scorerA.id, teamId: teamA1.id, position: "Any" });

  const emailA = `${MARK}-usera@example.com`;
  const regA = await fetch(`${API}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: emailA, password: "qa-test-password-123", name: "Recovery A" }) }).then((r) => r.json());
  const userIdA = regA.data.user.id as number;
  await db.insert(schema.wallets).values({ userId: userIdA, balanceCents: 500 }).onConflictDoUpdate({ target: schema.wallets.userId, set: { balanceCents: 500 } });
  const [onePack] = await db.select().from(schema.entryPackages).where(eq(schema.entryPackages.entryCount, 1)).limit(1);
  const buyA = await fetch(`${API}/api/nrl/rounds/${roundA.id}/enter-package`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${regA.data.token}` },
    body: JSON.stringify({ packageId: onePack.id, selections: [{ gameId: gameA.id, playerIds: [scorerA.id] }], idempotencyKey: `${MARK}-buyA` }),
  }).then((r) => r.json());
  assert(buyA.ok, "scenario A: entry purchased");
  const entryIdA = buyA.data.entryIds[0] as number;

  await db.update(schema.games).set({ status: "final", kickoff: new Date(Date.now() - 3600_000), homeScore: 10, awayScore: 6 }).where(eq(schema.games.id, gameA.id));
  await db.insert(schema.playerGameStats).values({ gameId: gameA.id, playerId: scorerA.id, teamId: teamA1.id, tries: 1 });

  const compA = (await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, roundA.id)))[0];

  // Simulate exactly what a crash-after-commit-before-credit would leave behind: the core
  // settlement fields committed and the entry's display allocation written, but no wallet
  // credit ever applied — bypassing the API entirely to write this state directly.
  await db
    .update(schema.competitions)
    .set({ status: "settled", winnerCount: 1, awardedAmountCents: 6000, rolloverOutCents: 0, prizeSettledAt: new Date() })
    .where(eq(schema.competitions.id, compA.id));
  await db.update(schema.competitionEntries).set({ result: "perfect", prizeAllocationCents: 6000 }).where(eq(schema.competitionEntries.id, entryIdA));

  const balanceBeforeRetryA = (await db.select().from(schema.wallets).where(eq(schema.wallets.userId, userIdA)))[0].balanceCents;
  assert(balanceBeforeRetryA === 0, `scenario A: wallet still shows the un-credited state before retry (got ${balanceBeforeRetryA})`);

  const adminRegA = await fetch(`${API}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${MARK}-admin@example.com`, password: "qa-test-password-123", name: "Recovery Admin" }) }).then((r) => r.json());
  const adminId = adminRegA.data.user.id as number;
  await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, adminId));
  const adminAuth = { Authorization: `Bearer ${adminRegA.data.token}` };

  const retrySettleA = await fetch(`${API}/api/admin/competitions/${compA.id}/settle`, { method: "POST", headers: adminAuth }).then((r) => r.json());
  assert(retrySettleA.ok, `scenario A: retry settle call succeeds (${JSON.stringify(retrySettleA).slice(0, 200)})`);

  const walletAfterRetryA = (await db.select().from(schema.wallets).where(eq(schema.wallets.userId, userIdA)))[0];
  assert(walletAfterRetryA.balanceCents === 6000, `*** the retry actually completed the missed credit — wallet now shows $60 (got ${walletAfterRetryA.balanceCents}) ***`);
  const creditRowsA = await db.select().from(schema.walletTransactions).where(and(eq(schema.walletTransactions.userId, userIdA), eq(schema.walletTransactions.type, "winning_credit")));
  assert(creditRowsA.length === 1, `scenario A: exactly one winning_credit row exists after the retry (got ${creditRowsA.length})`);

  // A SECOND retry must not double-credit.
  await fetch(`${API}/api/admin/competitions/${compA.id}/settle`, { method: "POST", headers: adminAuth });
  const walletAfterSecondRetryA = (await db.select().from(schema.wallets).where(eq(schema.wallets.userId, userIdA)))[0];
  assert(walletAfterSecondRetryA.balanceCents === 6000, `scenario A: a second retry does NOT double-credit (still ${walletAfterSecondRetryA.balanceCents})`);

  // --- Scenario B: a failed rollover push, simulating a crash between the source's own
  // settlement commit and the target actually receiving rolloverInCents. Round 1 settles
  // with zero winners; round 2 already exists (created up front) but never received the
  // rollover the first "attempt" (which we simulate as never having happened at all).
  // Retrying settle on round 1 must actually deliver the rollover to round 2. ---
  const [roundB1] = await db.insert(schema.rounds).values({ seasonId: season.id, roundNumber: 2, name: `${MARK}-B1` }).returning();
  const [roundB2] = await db.insert(schema.rounds).values({ seasonId: season.id, roundNumber: 3, name: `${MARK}-B2` }).returning();
  const [teamB1] = await db.insert(schema.teams).values({ sportId: sport.id, slug: `${MARK}-b1`, name: "Rec B1", shortName: "RB1" }).returning();
  const [teamB2] = await db.insert(schema.teams).values({ sportId: sport.id, slug: `${MARK}-b2`, name: "Rec B2", shortName: "RB2" }).returning();
  const [gameB1] = await db
    .insert(schema.games)
    .values({ roundId: roundB1.id, homeTeamId: teamB1.id, awayTeamId: teamB2.id, kickoff: new Date(Date.now() - 3600_000), status: "final", homeScore: 5, awayScore: 5 })
    .returning();

  // Create round 2's competition FIRST (so it exists to receive the rollover) — via an
  // actual entry attempt, since merely viewing a round is read-only and never creates one.
  const [teamB3] = await db.insert(schema.teams).values({ sportId: sport.id, slug: `${MARK}-b3`, name: "Rec B3", shortName: "RB3" }).returning();
  const [teamB4] = await db.insert(schema.teams).values({ sportId: sport.id, slug: `${MARK}-b4`, name: "Rec B4", shortName: "RB4" }).returning();
  const [gameB2] = await db
    .insert(schema.games)
    .values({ roundId: roundB2.id, homeTeamId: teamB3.id, awayTeamId: teamB4.id, kickoff: new Date(Date.now() + 3600_000), status: "scheduled" })
    .returning();
  const [scorerB2] = await db.insert(schema.players).values({ sportId: sport.id, teamId: teamB3.id, firstName: MARK, lastName: "B2Player", position: "Any" }).returning();
  await db.insert(schema.gameLineups).values({ gameId: gameB2.id, playerId: scorerB2.id, teamId: teamB3.id, position: "Any" });

  const emailB = `${MARK}-userb@example.com`;
  const regB = await fetch(`${API}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: emailB, password: "qa-test-password-123", name: "Recovery B" }) }).then((r) => r.json());
  const userIdB = regB.data.user.id as number;
  await db.insert(schema.wallets).values({ userId: userIdB, balanceCents: 500 }).onConflictDoUpdate({ target: schema.wallets.userId, set: { balanceCents: 500 } });
  const buyB2 = await fetch(`${API}/api/nrl/rounds/${roundB2.id}/enter-package`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${regB.data.token}` },
    body: JSON.stringify({ packageId: onePack.id, selections: [{ gameId: gameB2.id, playerIds: [scorerB2.id] }], idempotencyKey: `${MARK}-buyB2` }),
  }).then((r) => r.json());
  assert(buyB2.ok, "scenario B: round 2 entry created (this creates round 2's competition row)");
  const compB2 = (await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, roundB2.id)))[0];
  assert(compB2.rolloverInCents === 0, "scenario B: round 2's competition starts with zero rollover");

  // Now simulate round 1's failed-mid-rollover-push state directly: settled with zero
  // winners, rolloverOutCents computed, but rolloverClaimed still false and round 2's
  // rolloverInCents never actually delivered (exactly what a crash right after the source
  // commit but before/during tryClaimRollover would leave behind). Round 1's competition
  // row is inserted directly here (rather than via an entry attempt, which isn't needed
  // for this test) since we're about to overwrite its settlement state directly anyway.
  const [compB1] = await db.insert(schema.competitions).values({ sportId: sport.id, roundId: roundB1.id, name: `${MARK}-B1-comp` }).returning();
  await db
    .update(schema.competitions)
    .set({ status: "settled", winnerCount: 0, awardedAmountCents: 0, rolloverOutCents: 6000, prizeSettledAt: new Date(), rolloverClaimed: false })
    .where(eq(schema.competitions.id, compB1.id));

  const retrySettleB1 = await fetch(`${API}/api/admin/competitions/${compB1.id}/settle`, { method: "POST", headers: adminAuth }).then((r) => r.json());
  assert(retrySettleB1.ok, `scenario B: retry settle on round 1 succeeds (${JSON.stringify(retrySettleB1).slice(0, 200)})`);

  const compB2After = (await db.select().from(schema.competitions).where(eq(schema.competitions.id, compB2.id)))[0];
  assert(compB2After.rolloverInCents === 6000, `*** the retry actually delivered the missed rollover — round 2 now shows $60 rolled in (got ${compB2After.rolloverInCents}) ***`);
  const compB1After = (await db.select().from(schema.competitions).where(eq(schema.competitions.id, compB1.id)))[0];
  assert(compB1After.rolloverClaimed === true, "scenario B: round 1's rollover is now correctly marked claimed");

  // A second retry must not double-deliver (would be a real invented-money bug if it did).
  await fetch(`${API}/api/admin/competitions/${compB1.id}/settle`, { method: "POST", headers: adminAuth });
  const compB2AfterSecond = (await db.select().from(schema.competitions).where(eq(schema.competitions.id, compB2.id)))[0];
  assert(compB2AfterSecond.rolloverInCents === 6000, `scenario B: a second retry does NOT double-deliver the rollover (still ${compB2AfterSecond.rolloverInCents})`);

  console.log(`\n${passed} checks passed`);

  // --- cleanup ---
  for (const entryId of [entryIdA]) {
    await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, entryId));
    await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId));
  }
  await db.delete(schema.entrySelections).where(eq(schema.entrySelections.gameId, gameB2.id));
  await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, compB2.id));
  await db.delete(schema.walletTransactions).where(eq(schema.walletTransactions.userId, userIdA));
  await db.delete(schema.walletTransactions).where(eq(schema.walletTransactions.userId, userIdB));
  await db.delete(schema.wallets).where(eq(schema.wallets.userId, userIdA));
  await db.delete(schema.wallets).where(eq(schema.wallets.userId, userIdB));
  await db.delete(schema.paymentTransactions).where(eq(schema.paymentTransactions.userId, userIdA));
  await db.delete(schema.paymentTransactions).where(eq(schema.paymentTransactions.userId, userIdB));
  await db.delete(schema.competitions).where(eq(schema.competitions.id, compA.id));
  await db.delete(schema.competitions).where(eq(schema.competitions.id, compB1.id));
  await db.delete(schema.competitions).where(eq(schema.competitions.id, compB2.id));
  await db.delete(schema.playerGameStats).where(eq(schema.playerGameStats.gameId, gameA.id));
  await db.delete(schema.gameLineups).where(eq(schema.gameLineups.gameId, gameA.id));
  await db.delete(schema.gameLineups).where(eq(schema.gameLineups.gameId, gameB2.id));
  for (const g of [gameA, gameB1, gameB2]) await db.delete(schema.games).where(eq(schema.games.id, g.id));
  for (const p of [scorerA, scorerB2]) await db.delete(schema.players).where(eq(schema.players.id, p.id));
  for (const t of [teamA1, teamA2, teamB1, teamB2, teamB3, teamB4]) await db.delete(schema.teams).where(eq(schema.teams.id, t.id));
  for (const r of [roundA, roundB1, roundB2]) await db.delete(schema.rounds).where(eq(schema.rounds.id, r.id));
  await db.delete(schema.seasons).where(eq(schema.seasons.id, season.id));
  for (const uid of [userIdA, userIdB, adminId]) {
    const sessions = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, uid));
    for (const s of sessions) await db.delete(schema.sessions).where(eq(schema.sessions.id, s.id));
    await db.delete(schema.users).where(eq(schema.users.id, uid));
  }
  console.log("cleaned up");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
