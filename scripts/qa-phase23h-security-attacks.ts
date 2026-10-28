/**
 * PHASE 23H — live security audit: attempts specific malicious/client-side manipulations
 * against the real running server and confirms every one is rejected server-side.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
const MARK = `qa23h-sec-${Date.now()}`;
const API = "http://localhost:3000";

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("PASS: " + msg);
  passed++;
}

async function registerUser(email: string) {
  const r = await fetch(`${API}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "qa-test-password-123", name: "Sec QA" }),
  }).then((res) => res.json());
  return { token: r.data.token as string, userId: r.data.user.id as number };
}

async function main() {
  const [sport] = await db.select().from(schema.sports).where(eq(schema.sports.code, "nrl")).limit(1);
  const [season] = await db.insert(schema.seasons).values({ sportId: sport.id, year: 2099, label: MARK }).returning();
  const [round] = await db.insert(schema.rounds).values({ seasonId: season.id, roundNumber: 1, name: MARK }).returning();
  const [teamA] = await db.insert(schema.teams).values({ sportId: sport.id, slug: `${MARK}-a`, name: "Sec A", shortName: "SCA" }).returning();
  const [teamB] = await db.insert(schema.teams).values({ sportId: sport.id, slug: `${MARK}-b`, name: "Sec B", shortName: "SCB" }).returning();

  // Game 1: open (future kickoff), Game 2: locked (already live).
  const [openGame] = await db
    .insert(schema.games)
    .values({ roundId: round.id, homeTeamId: teamA.id, awayTeamId: teamB.id, kickoff: new Date(Date.now() + 3600_000), status: "scheduled" })
    .returning();
  const [lockedGame] = await db
    .insert(schema.games)
    .values({ roundId: round.id, homeTeamId: teamA.id, awayTeamId: teamB.id, kickoff: new Date(Date.now() - 3600_000), status: "live" })
    .returning();

  const [eligiblePlayer] = await db.insert(schema.players).values({ sportId: sport.id, teamId: teamA.id, firstName: MARK, lastName: "Eligible", position: "Any" }).returning();
  const [ineligiblePlayer] = await db.insert(schema.players).values({ sportId: sport.id, teamId: teamB.id, firstName: MARK, lastName: "Ineligible", position: "Any" }).returning();
  await db.insert(schema.gameLineups).values([
    { gameId: openGame.id, playerId: eligiblePlayer.id, teamId: teamA.id, position: "Any" },
    { gameId: lockedGame.id, playerId: eligiblePlayer.id, teamId: teamA.id, position: "Any" },
  ]);
  // ineligiblePlayer is deliberately NOT in any game_lineups row — never eligible anywhere.

  const userA = await registerUser(`${MARK}-a@example.com`);
  const userB = await registerUser(`${MARK}-b@example.com`);
  const authA = { Authorization: `Bearer ${userA.token}` };
  const authB = { Authorization: `Bearer ${userB.token}` };

  // --- 1. Submitting a selection for an already-started (locked) game is rejected ---
  const lockedAttempt = await fetch(`${API}/api/nrl/rounds/${round.id}/entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authA },
    body: JSON.stringify({ selections: [{ gameId: openGame.id, playerIds: [eligiblePlayer.id] }, { gameId: lockedGame.id, playerIds: [eligiblePlayer.id] }] }),
  });
  assert(lockedAttempt.status === 422, `submitting a selection for an already-live game is rejected (422), got ${lockedAttempt.status}`);

  // --- 2. Submitting a player not eligible for the game (never in its lineup) is rejected ---
  // Use only the open game so we isolate the eligibility failure from the lock failure.
  const [openOnlyRound] = await db.insert(schema.rounds).values({ seasonId: season.id, roundNumber: 2, name: `${MARK}-r2` }).returning();
  const [openOnlyGame] = await db
    .insert(schema.games)
    .values({ roundId: openOnlyRound.id, homeTeamId: teamA.id, awayTeamId: teamB.id, kickoff: new Date(Date.now() + 3600_000), status: "scheduled" })
    .returning();
  await db.insert(schema.gameLineups).values({ gameId: openOnlyGame.id, playerId: eligiblePlayer.id, teamId: teamA.id, position: "Any" });
  const ineligibleAttempt = await fetch(`${API}/api/nrl/rounds/${openOnlyRound.id}/entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authA },
    body: JSON.stringify({ selections: [{ gameId: openOnlyGame.id, playerIds: [ineligiblePlayer.id] }] }),
  });
  assert(ineligibleAttempt.status === 422, `submitting a player never in this game's lineup is rejected (422), got ${ineligibleAttempt.status}`);

  // --- 3. A client-supplied "result"/"paymentStatus"/"prizeAllocationCents" in the entry body is ignored ---
  const tamperedAttempt = await fetch(`${API}/api/nrl/rounds/${openOnlyRound.id}/entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authA },
    body: JSON.stringify({
      selections: [{ gameId: openOnlyGame.id, playerIds: [eligiblePlayer.id] }],
      result: "perfect",
      paymentStatus: "paid",
      prizeAllocationCents: 999999,
      entryFeeCents: 0,
    }),
  }).then((r) => r.json());
  const tamperedEntryId = tamperedAttempt.data.entryId as number;
  const tamperedRow = (await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, tamperedEntryId)))[0];
  assert(tamperedRow.result === "pending", `client-supplied result:"perfect" is ignored — entry is really "pending" (got ${tamperedRow.result})`);
  assert(tamperedRow.prizeAllocationCents === 0, `client-supplied prizeAllocationCents is ignored — really 0 (got ${tamperedRow.prizeAllocationCents})`);
  assert(tamperedRow.paymentStatus !== "paid" || tamperedRow.paidAmountCents === 500, `paymentStatus/paidAmountCents reflect the server-derived $5 entry fee, never a client-supplied 0 (paidAmountCents=${tamperedRow.paidAmountCents})`);

  // --- 4. User B cannot read User A's entry (IDOR) ---
  const idorAttempt = await fetch(`${API}/api/entries/${tamperedEntryId}`, { headers: authB });
  assert(idorAttempt.status === 403, `a different user cannot read this entry via /api/entries/[id] (403), got ${idorAttempt.status}`);
  const ownerRead = await fetch(`${API}/api/entries/${tamperedEntryId}`, { headers: authA });
  assert(ownerRead.status === 200, `the entry's real owner CAN read it (200), got ${ownerRead.status}`);

  // --- 5. Non-admin cannot trigger settlement or the commercial-model override ---
  const [competition] = await db.insert(schema.competitions).values({ sportId: sport.id, roundId: round.id, name: MARK, entryFeeCents: 500, status: "closed" }).returning();
  const settleAttempt = await fetch(`${API}/api/admin/competitions/${competition.id}/settle`, { method: "POST", headers: authA });
  assert(settleAttempt.status === 403, `non-admin cannot trigger settlement (403), got ${settleAttempt.status}`);
  const commercialAttempt = await fetch(`${API}/api/admin/competitions/${competition.id}/commercial-model`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authA },
    body: JSON.stringify({ prizePoolAllocationBps: 0 }),
  });
  assert(commercialAttempt.status === 403, `non-admin cannot override the commercial model (403), got ${commercialAttempt.status}`);
  const statusAttempt = await fetch(`${API}/api/admin/competitions/${competition.id}`, { method: "PATCH", headers: authA, body: "{}" });
  assert([403, 404, 405].includes(statusAttempt.status), `non-admin cannot PATCH the competition directly (403/404/405), got ${statusAttempt.status}`);

  console.log(`\n${passed} checks passed`);

  // cleanup
  await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, tamperedEntryId));
  await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.id, tamperedEntryId));
  await db.delete(schema.paymentTransactions).where(eq(schema.paymentTransactions.userId, userA.userId));
  await db.delete(schema.competitions).where(eq(schema.competitions.id, competition.id));
  await db.delete(schema.gameLineups).where(eq(schema.gameLineups.gameId, openGame.id));
  await db.delete(schema.gameLineups).where(eq(schema.gameLineups.gameId, lockedGame.id));
  await db.delete(schema.gameLineups).where(eq(schema.gameLineups.gameId, openOnlyGame.id));
  await db.delete(schema.games).where(eq(schema.games.id, openGame.id));
  await db.delete(schema.games).where(eq(schema.games.id, lockedGame.id));
  await db.delete(schema.games).where(eq(schema.games.id, openOnlyGame.id));
  await db.delete(schema.players).where(eq(schema.players.id, eligiblePlayer.id));
  await db.delete(schema.players).where(eq(schema.players.id, ineligiblePlayer.id));
  await db.delete(schema.teams).where(eq(schema.teams.id, teamA.id));
  await db.delete(schema.teams).where(eq(schema.teams.id, teamB.id));
  await db.delete(schema.rounds).where(eq(schema.rounds.id, round.id));
  await db.delete(schema.rounds).where(eq(schema.rounds.id, openOnlyRound.id));
  await db.delete(schema.seasons).where(eq(schema.seasons.id, season.id));
  for (const u of [userA, userB]) {
    const sessions = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, u.userId));
    for (const s of sessions) await db.delete(schema.sessions).where(eq(schema.sessions.id, s.id));
    await db.delete(schema.users).where(eq(schema.users.id, u.userId));
  }
  console.log("cleaned up");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
