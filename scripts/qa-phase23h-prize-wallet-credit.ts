/**
 * PHASE 23H — CRITICAL: verifies a PERFECT winner's prize is actually credited to their
 * spendable Perfect Play Balance wallet, not just recorded as competition_entries.prizeAllocationCents.
 * (Found via code audit: settleCompetition wrote prizeAllocationCents but never called
 * creditPrizeWinnings — winners could never actually withdraw/spend their prize.)
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
const MARK = `qa23h-prizewallet-${Date.now()}`;
// Unique per run (rather than a fixed constant) so a crashed prior run's un-cleaned season
// row can never collide with seasons_sport_year_unique on the next run.
const TEST_YEAR = 2100 + (Date.now() % 1000);
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
  const [round] = await db.insert(schema.rounds).values({ seasonId: season.id, roundNumber: 1, name: MARK }).returning();
  const [teamA] = await db.insert(schema.teams).values({ sportId: sport.id, slug: `${MARK}-a`, name: "PW A", shortName: "PWA" }).returning();
  const [teamB] = await db.insert(schema.teams).values({ sportId: sport.id, slug: `${MARK}-b`, name: "PW B", shortName: "PWB" }).returning();
  // Created still-open (future kickoff) so the entry purchase below is accepted; flipped to
  // "final" with the winning stat further down, right before settlement.
  const [game] = await db
    .insert(schema.games)
    .values({ roundId: round.id, homeTeamId: teamA.id, awayTeamId: teamB.id, kickoff: new Date(Date.now() + 3600_000), status: "scheduled" })
    .returning();
  const [scorer] = await db.insert(schema.players).values({ sportId: sport.id, teamId: teamA.id, firstName: MARK, lastName: "Winner", position: "Any" }).returning();
  await db.insert(schema.gameLineups).values({ gameId: game.id, playerId: scorer.id, teamId: teamA.id, position: "Any" });

  const email = `${MARK}@example.com`;
  const registerRes = await fetch(`${API}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "qa-test-password-123", name: "Prize Wallet QA" }),
  }).then((r) => r.json());
  const userId = registerRes.data.user.id as number;

  // Fund wallet + fund via wallet-package purchase (paid=true) so the entry is a real "paid" one.
  await db.insert(schema.wallets).values({ userId, balanceCents: 500 }).onConflictDoUpdate({ target: schema.wallets.userId, set: { balanceCents: 500 } });
  const [onePack] = await db.select().from(schema.entryPackages).where(eq(schema.entryPackages.entryCount, 1)).limit(1);
  const buyRes = await fetch(`${API}/api/nrl/rounds/${round.id}/enter-package`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${registerRes.data.token}` },
    body: JSON.stringify({ packageId: onePack.id, selectionsPerEntry: [[{ gameId: game.id, playerIds: [scorer.id] }]] }),
  }).then((r) => r.json());
  assert(buyRes.ok, "entry purchased successfully");
  const entryId = buyRes.data.entryIds[0] as number;

  const balanceBeforeSettlement = (await db.select().from(schema.wallets).where(eq(schema.wallets.userId, userId)))[0].balanceCents;
  assert(balanceBeforeSettlement === 0, `wallet correctly debited $5 for the entry (balance=${balanceBeforeSettlement})`);

  // Now the game plays out: flip to final with the winning stat so settlement scores this entry PERFECT.
  await db.update(schema.games).set({ status: "final", kickoff: new Date(Date.now() - 3600_000), homeScore: 10, awayScore: 6 }).where(eq(schema.games.id, game.id));
  await db.insert(schema.playerGameStats).values({ gameId: game.id, playerId: scorer.id, teamId: teamA.id, tries: 1 });

  // Admin closes + settles the competition.
  const compRow = (await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, round.id)))[0];
  const adminEmail = `${MARK}-admin@example.com`;
  const adminReg = await fetch(`${API}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password: "qa-test-password-123", name: "Admin QA" }),
  }).then((r) => r.json());
  const adminId = adminReg.data.user.id as number;
  await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, adminId));
  const adminAuth = { Authorization: `Bearer ${adminReg.data.token}` };

  await fetch(`${API}/api/admin/competitions/${compRow.id}/close`, { method: "POST", headers: adminAuth });
  const settleRes = await fetch(`${API}/api/admin/competitions/${compRow.id}/settle`, { method: "POST", headers: adminAuth }).then((r) => r.json());
  assert(settleRes.ok, `settlement succeeds (${JSON.stringify(settleRes).slice(0, 200)})`);

  const entryAfter = (await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId)))[0];
  assert(entryAfter.result === "perfect", `the entry settled PERFECT (got ${entryAfter.result})`);
  assert(entryAfter.prizeAllocationCents === 6000, `prizeAllocationCents recorded correctly ($60, sole winner) — got ${entryAfter.prizeAllocationCents}`);

  const walletAfter = (await db.select().from(schema.wallets).where(eq(schema.wallets.userId, userId)))[0];
  assert(walletAfter.balanceCents === 6000, `*** CRITICAL *** the winner's spendable wallet balance actually increased by $60 (got ${walletAfter.balanceCents} cents)`);

  const winningTx = await db.select().from(schema.walletTransactions).where(eq(schema.walletTransactions.userId, userId));
  const creditRow = winningTx.find((t) => t.type === "winning_credit");
  assert(!!creditRow, "a winning_credit wallet_transactions ledger row exists (auditable trail)");
  assert(creditRow!.amountCents === 6000, `the ledger row's amount matches exactly (got ${creditRow!.amountCents})`);

  // Idempotency: re-settling must NEVER credit the wallet a second time.
  await fetch(`${API}/api/admin/competitions/${compRow.id}/settle`, { method: "POST", headers: adminAuth });
  const walletAfterDuplicate = (await db.select().from(schema.wallets).where(eq(schema.wallets.userId, userId)))[0];
  assert(walletAfterDuplicate.balanceCents === 6000, `re-settling does NOT double-credit the wallet (still ${walletAfterDuplicate.balanceCents} cents)`);
  const winningTxAfterDuplicate = await db.select().from(schema.walletTransactions).where(eq(schema.walletTransactions.userId, userId));
  assert(winningTxAfterDuplicate.filter((t) => t.type === "winning_credit").length === 1, "still exactly one winning_credit ledger row after a duplicate settle call");

  console.log(`\n${passed} checks passed`);

  // cleanup
  await db.delete(schema.walletTransactions).where(eq(schema.walletTransactions.userId, userId));
  await db.delete(schema.wallets).where(eq(schema.wallets.userId, userId));
  await db.delete(schema.paymentTransactions).where(eq(schema.paymentTransactions.userId, userId));
  await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, entryId));
  await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId));
  await db.delete(schema.competitions).where(eq(schema.competitions.id, compRow.id));
  await db.delete(schema.playerGameStats).where(eq(schema.playerGameStats.gameId, game.id));
  await db.delete(schema.gameLineups).where(eq(schema.gameLineups.gameId, game.id));
  await db.delete(schema.games).where(eq(schema.games.id, game.id));
  await db.delete(schema.players).where(eq(schema.players.id, scorer.id));
  await db.delete(schema.teams).where(eq(schema.teams.id, teamA.id));
  await db.delete(schema.teams).where(eq(schema.teams.id, teamB.id));
  await db.delete(schema.rounds).where(eq(schema.rounds.id, round.id));
  await db.delete(schema.seasons).where(eq(schema.seasons.id, season.id));
  for (const uid of [userId, adminId]) {
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
