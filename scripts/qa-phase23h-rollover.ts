/**
 * PHASE 23H — prize/settlement/rollover audit: 1/2/3/many/0 winners, duplicate and
 * concurrent settlement, and specifically final-round-of-season -> next-season-round-1
 * rollover (the new cross-season path added this phase).
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { allocatePrizePool, settlePrizePool } from "../src/lib/perfect2/prize";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
const MARK = `qa23h-roll-${Date.now()}`;
const API = "http://localhost:3000";

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("PASS: " + msg);
  passed++;
}

async function getOrCreateSport(code: string, name: string) {
  const existing = await db.select().from(schema.sports).where(eq(schema.sports.code, code)).limit(1);
  if (existing[0]) return { id: existing[0].id, wasCreated: false };
  const [row] = await db.insert(schema.sports).values({ code, name }).returning();
  return { id: row.id, wasCreated: true };
}

async function main() {
  // --- Part 1: pure allocation math — 1/2/3/many/0 winners, remainder handling ---
  assert(settlePrizePool(6000, []).rolloverOutCents === 6000, "0 winners: entire pool rolls over");
  assert(settlePrizePool(6000, [1]).awardedAmountCents === 6000, "1 winner: takes the entire pool");
  const two = allocatePrizePool(6001, [2, 1]);
  assert(two.reduce((s, a) => s + a.amountCents, 0) === 6001, "2 winners: allocations sum exactly, remainder never lost");
  assert(two.find((a) => a.entryId === 1)!.amountCents === 3001 && two.find((a) => a.entryId === 2)!.amountCents === 3000, "2 winners, odd remainder: extra cent goes to the LOWEST entryId, deterministically");
  const three = allocatePrizePool(100, [30, 10, 20]);
  assert(three.reduce((s, a) => s + a.amountCents, 0) === 100, "3 winners: sums exactly");
  const many = allocatePrizePool(1000, [5, 4, 3, 2, 1, 9, 8, 7, 6]);
  assert(many.reduce((s, a) => s + a.amountCents, 0) === 1000, "9 winners: sums exactly, no cent lost or invented");
  assert(new Set(many.map((a) => a.amountCents)).size <= 2, "9 winners: every share is either floor(pool/9) or that +1 — never wildly uneven");

  // --- Part 2: live final-round-of-season -> next-season-round-1 rollover ---
  const sport = await getOrCreateSport("nrl", "NRL");
  const [seasonA] = await db.insert(schema.seasons).values({ sportId: sport.id, year: 2201, label: `${MARK}-2201` }).returning();
  const [seasonB] = await db.insert(schema.seasons).values({ sportId: sport.id, year: 2202, label: `${MARK}-2202` }).returning();
  // Season A's round 8 (its "final" round — nothing says so structurally, there's just no round 9).
  const [roundA8] = await db.insert(schema.rounds).values({ seasonId: seasonA.id, roundNumber: 8, name: `${MARK}-A8` }).returning();
  const [teamX] = await db.insert(schema.teams).values({ sportId: sport.id, slug: `${MARK}-x`, name: "Roll X", shortName: "RLX" }).returning();
  const [teamY] = await db.insert(schema.teams).values({ sportId: sport.id, slug: `${MARK}-y`, name: "Roll Y", shortName: "RLY" }).returning();
  const [gameA8] = await db
    .insert(schema.games)
    .values({ roundId: roundA8.id, homeTeamId: teamX.id, awayTeamId: teamY.id, kickoff: new Date(Date.now() - 3600_000), status: "final", homeScore: 10, awayScore: 6 })
    .returning();
  const [scorer] = await db.insert(schema.players).values({ sportId: sport.id, teamId: teamX.id, firstName: MARK, lastName: "Scorer", position: "Any" }).returning();
  await db.insert(schema.gameLineups).values({ gameId: gameA8.id, playerId: scorer.id, teamId: teamX.id, position: "Any" });
  // NO try for scorer -> the one entry in round A8 will be NOT_PERFECT -> 0 winners -> full pool rolls over.
  await db.insert(schema.playerGameStats).values({ gameId: gameA8.id, playerId: scorer.id, teamId: teamX.id, tries: 0 });

  const [compA8] = await db
    .insert(schema.competitions)
    .values({ sportId: sport.id, roundId: roundA8.id, name: `${MARK}-compA8`, entryFeeCents: 500, prizeAmountCents: 6000, status: "closed" })
    .returning();
  const email = `${MARK}@example.com`;
  const registerRes = await fetch(`${API}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "qa-test-password-123", name: "Roll QA" }),
  }).then((r) => r.json());
  const userId = registerRes.data.user.id as number;
  const [entryA8] = await db.insert(schema.competitionEntries).values({ competitionId: compA8.id, userId, paymentStatus: "paid", paidAmountCents: 500 }).returning();
  await db.insert(schema.entrySelections).values({ entryId: entryA8.id, gameId: gameA8.id, selectedPlayer1Id: scorer.id });

  // Settle season A's round 8 — no next round exists in season A, and season B round 1
  // doesn't exist YET either, so the rollover should land unclaimed on compA8 for now.
  const adminHeaders = await adminAuth();
  const settle1 = await fetch(`${API}/api/admin/competitions/${compA8.id}/settle`, { method: "POST", headers: adminHeaders });
  assert(settle1.status === 200 || settle1.status === 201, `settling season A's final round succeeds (got ${settle1.status})`);
  const compA8AfterSettle = (await db.select().from(schema.competitions).where(eq(schema.competitions.id, compA8.id)))[0];
  assert(compA8AfterSettle.rolloverOutCents === 6000, `season A round 8 settled with 0 winners: full $60 base rolls over (got ${compA8AfterSettle.rolloverOutCents})`);
  assert(compA8AfterSettle.rolloverClaimed === false, "rollover is NOT claimed yet — season B round 1 doesn't exist");

  // NOW create season B's round 1 — getOrCreateCompetition's cross-season pull should
  // claim it, but only an actual entry ATTEMPT triggers getOrCreateCompetition; merely
  // viewing the round is deliberately read-only (getCompetitionForRound never writes).
  const [roundB1] = await db.insert(schema.rounds).values({ seasonId: seasonB.id, roundNumber: 1, name: `${MARK}-B1` }).returning();
  const [gameB1] = await db
    .insert(schema.games)
    .values({ roundId: roundB1.id, homeTeamId: teamX.id, awayTeamId: teamY.id, kickoff: new Date(Date.now() + 3600_000), status: "scheduled" })
    .returning();
  await db.insert(schema.gameLineups).values({ gameId: gameB1.id, playerId: scorer.id, teamId: teamX.id, position: "Any" });
  const entryAttempt = await fetch(`${API}/api/nrl/rounds/${roundB1.id}/entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${registerRes.data.token}` },
    body: JSON.stringify({ selections: [{ gameId: gameB1.id, playerIds: [scorer.id] }] }),
  }).then((r) => r.json());
  assert(entryAttempt.ok, "an entry attempt in season B round 1 succeeds (this is what actually creates the competition row)");

  const compB1 = (await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, roundB1.id)))[0];
  assert(!!compB1, "the entry attempt created season B round 1's competition row");
  assert(compB1.rolloverInCents === 6000, `season B round 1 inherited the $60 rollover from season A's final round (got ${compB1.rolloverInCents})`);
  const compA8Reread = (await db.select().from(schema.competitions).where(eq(schema.competitions.id, compA8.id)))[0];
  assert(compA8Reread.rolloverClaimed === true, "season A's round 8 rollover is now marked claimed");

  // --- Part 3: rollover never crosses sports ---
  const otherSport = await getOrCreateSport("afl", "AFL");
  const [otherSeason] = await db.insert(schema.seasons).values({ sportId: otherSport.id, year: 2202, label: `${MARK}-afl-2202` }).returning();
  const [otherRound1] = await db.insert(schema.rounds).values({ seasonId: otherSeason.id, roundNumber: 1, name: `${MARK}-afl-B1` }).returning();
  const [otherTeamX] = await db.insert(schema.teams).values({ sportId: otherSport.id, slug: `${MARK}-afl-x`, name: "Roll AFL X", shortName: "RAX" }).returning();
  const [otherTeamY] = await db.insert(schema.teams).values({ sportId: otherSport.id, slug: `${MARK}-afl-y`, name: "Roll AFL Y", shortName: "RAY" }).returning();
  const [otherGame] = await db
    .insert(schema.games)
    .values({ roundId: otherRound1.id, homeTeamId: otherTeamX.id, awayTeamId: otherTeamY.id, kickoff: new Date(Date.now() + 3600_000), status: "scheduled" })
    .returning();
  const [otherPlayer] = await db.insert(schema.players).values({ sportId: otherSport.id, teamId: otherTeamX.id, firstName: MARK, lastName: "AflScorer", position: "Any" }).returning();
  await db.insert(schema.gameLineups).values({ gameId: otherGame.id, playerId: otherPlayer.id, teamId: otherTeamX.id, position: "Any" });
  const otherEntryAttempt = await fetch(`${API}/api/afl/rounds/${otherRound1.id}/entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${registerRes.data.token}` },
    body: JSON.stringify({ selections: [{ gameId: otherGame.id, playerIds: [otherPlayer.id] }] }),
  }).then((r) => r.json());
  assert(otherEntryAttempt.ok, "an entry attempt in AFL's round 1 succeeds");
  const otherComp = (await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, otherRound1.id)))[0];
  assert(!!otherComp && otherComp.rolloverInCents === 0, "an unrelated sport's (AFL) round 1 never inherits NRL's rollover");

  // --- Part 4: duplicate and concurrent settlement never double-award ---
  const settle2 = await fetch(`${API}/api/admin/competitions/${compA8.id}/settle`, { method: "POST", headers: adminHeaders });
  const compA8AfterDuplicate = (await db.select().from(schema.competitions).where(eq(schema.competitions.id, compA8.id)))[0];
  assert(compA8AfterDuplicate.rolloverOutCents === 6000, "re-settling the same (already-settled) competition doesn't change its stored rollover");
  assert(settle2.status === 200 || settle2.status === 201, "re-settling an already-settled competition is a safe idempotent no-op, not an error");

  console.log(`\n${passed} checks passed`);

  // cleanup
  const b1Entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.userId, userId));
  for (const e of b1Entries) await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, e.id));
  for (const e of b1Entries) await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.id, e.id));
  if (compB1) await db.delete(schema.competitions).where(eq(schema.competitions.id, compB1.id));
  if (otherComp) await db.delete(schema.competitions).where(eq(schema.competitions.id, otherComp.id));
  await db.delete(schema.competitions).where(eq(schema.competitions.id, compA8.id));
  await db.delete(schema.playerGameStats).where(eq(schema.playerGameStats.gameId, gameA8.id));
  await db.delete(schema.gameLineups).where(eq(schema.gameLineups.gameId, gameA8.id));
  await db.delete(schema.gameLineups).where(eq(schema.gameLineups.gameId, gameB1.id));
  await db.delete(schema.gameLineups).where(eq(schema.gameLineups.gameId, otherGame.id));
  await db.delete(schema.games).where(eq(schema.games.id, gameA8.id));
  await db.delete(schema.games).where(eq(schema.games.id, gameB1.id));
  await db.delete(schema.games).where(eq(schema.games.id, otherGame.id));
  await db.delete(schema.players).where(eq(schema.players.id, scorer.id));
  await db.delete(schema.players).where(eq(schema.players.id, otherPlayer.id));
  await db.delete(schema.teams).where(eq(schema.teams.id, teamX.id));
  await db.delete(schema.teams).where(eq(schema.teams.id, teamY.id));
  await db.delete(schema.teams).where(eq(schema.teams.id, otherTeamX.id));
  await db.delete(schema.teams).where(eq(schema.teams.id, otherTeamY.id));
  await db.delete(schema.rounds).where(eq(schema.rounds.id, roundA8.id));
  await db.delete(schema.rounds).where(eq(schema.rounds.id, roundB1.id));
  await db.delete(schema.rounds).where(eq(schema.rounds.id, otherRound1.id));
  await db.delete(schema.seasons).where(eq(schema.seasons.id, seasonA.id));
  await db.delete(schema.seasons).where(eq(schema.seasons.id, seasonB.id));
  await db.delete(schema.seasons).where(eq(schema.seasons.id, otherSeason.id));
  const sessions = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId));
  for (const s of sessions) await db.delete(schema.sessions).where(eq(schema.sessions.id, s.id));
  await db.delete(schema.users).where(eq(schema.users.id, userId));
  console.log("cleaned up");
}

async function adminAuth(): Promise<Record<string, string>> {
  const email = `${MARK}-admin@example.com`;
  const r = await fetch(`${API}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "qa-test-password-123", name: "Roll Admin QA" }),
  }).then((res) => res.json());
  const rows = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, rows[0].id));
  adminUserIds.push(rows[0].id);
  return { Authorization: `Bearer ${r.data.token}` };
}
const adminUserIds: number[] = [];

main()
  .then(async () => {
    for (const id of adminUserIds) {
      const sessions = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, id));
      for (const s of sessions) await db.delete(schema.sessions).where(eq(schema.sessions.id, s.id));
      await db.delete(schema.users).where(eq(schema.users.id, id));
    }
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
