/**
 * PHASE 19 QA — verifies the prize-pool/rollover engine against the real running
 * backend. Seeds temporary, clearly-marked data (NRL rounds 1-4, AFL rounds 1-2, real
 * registered users), drives settlement through the real admin API, then deletes
 * everything it created. See docs/phase19-prize-pool.md for the design this verifies.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../src/db/schema";

const API_URL = "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
const MARK = "qa-test-internal-phase19";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json();
  return { status: res.status, body };
}
async function registerUser(email: string) {
  const r = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password: "qa-test-password-123", name: "QA" }) });
  if (!r.body.ok) throw new Error(`register failed for ${email}: ${JSON.stringify(r.body)}`);
  return r.body.data.token as string;
}

let passCount = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passCount++;
  console.log(`PASS: ${msg}`);
}

interface SeededRound {
  roundId: number;
  gameId: number;
  /** Both of these actually score once finalized — an entry must pick BOTH to go perfect. */
  scorer1PlayerId: number;
  scorer2PlayerId: number;
  /** Never scores — including this player in a pick guarantees that entry is not_perfect. */
  nonScorerPlayerId: number;
}

async function seedRound(sportId: number, seasonId: number, roundNumber: number, homeTeamId: number, awayTeamId: number): Promise<SeededRound> {
  const [round] = await db.insert(schema.rounds).values({ seasonId, roundNumber, name: `${MARK}-round-${sportId}-${roundNumber}` }).returning();
  const future = new Date(Date.now() + (roundNumber + 1) * 24 * 60 * 60 * 1000);
  const [game] = await db.insert(schema.games).values({ roundId: round.id, homeTeamId, awayTeamId, kickoff: future, status: "scheduled" }).returning();
  const [scorer1] = await db.insert(schema.players).values({ sportId, teamId: homeTeamId, firstName: "QA", lastName: `Scorer1_${round.id}` }).returning();
  const [scorer2] = await db.insert(schema.players).values({ sportId, teamId: awayTeamId, firstName: "QA", lastName: `Scorer2_${round.id}` }).returning();
  const [nonScorer] = await db.insert(schema.players).values({ sportId, teamId: awayTeamId, firstName: "QA", lastName: `NonScorer_${round.id}` }).returning();
  await db.insert(schema.gameLineups).values([
    { gameId: game.id, teamId: homeTeamId, playerId: scorer1.id, position: "Fullback" },
    { gameId: game.id, teamId: awayTeamId, playerId: scorer2.id, position: "Fullback" },
    { gameId: game.id, teamId: awayTeamId, playerId: nonScorer.id, position: "Winger" },
  ]);
  return { roundId: round.id, gameId: game.id, scorer1PlayerId: scorer1.id, scorer2PlayerId: scorer2.id, nonScorerPlayerId: nonScorer.id };
}

/** Marks both scorers as correct (tries/goals >= 1) and the non-scorer as incorrect (0). */
async function finalizeGamePerfectPossible(r: SeededRound, homeTeamId: number, awayTeamId: number, statField: "tries" | "goals") {
  await db.update(schema.games).set({ status: "final", homeScore: 20, awayScore: 18 }).where(eq(schema.games.id, r.gameId));
  await db.insert(schema.playerGameStats).values([
    { gameId: r.gameId, playerId: r.scorer1PlayerId, teamId: homeTeamId, tries: statField === "tries" ? 1 : 0, goals: statField === "goals" ? 1 : 0 },
    { gameId: r.gameId, playerId: r.scorer2PlayerId, teamId: awayTeamId, tries: statField === "tries" ? 1 : 0, goals: statField === "goals" ? 1 : 0 },
    { gameId: r.gameId, playerId: r.nonScorerPlayerId, teamId: awayTeamId, tries: 0, goals: 0 },
  ]);
}

/** Marks everyone (including the "scorers") as not scoring — used for the zero-winner scenarios. */
async function finalizeGameNoOneScores(r: SeededRound, homeTeamId: number, awayTeamId: number) {
  await db.update(schema.games).set({ status: "final", homeScore: 0, awayScore: 0 }).where(eq(schema.games.id, r.gameId));
  await db.insert(schema.playerGameStats).values([
    { gameId: r.gameId, playerId: r.scorer1PlayerId, teamId: homeTeamId, tries: 0, goals: 0 },
    { gameId: r.gameId, playerId: r.scorer2PlayerId, teamId: awayTeamId, tries: 0, goals: 0 },
    { gameId: r.gameId, playerId: r.nonScorerPlayerId, teamId: awayTeamId, tries: 0, goals: 0 },
  ]);
}

async function main() {
  console.log("=== PHASE 19 QA: prize pool + rollover engine ===");

  // Reuse the real dev DB's existing "nrl"/"afl" sport rows if they exist — sports.code is
  // globally unique.
  const existingNrl = (await db.select().from(schema.sports).where(eq(schema.sports.code, "nrl")))[0];
  const nrlWasCreatedByThisRun = !existingNrl;
  const nrl = existingNrl ?? (await db.insert(schema.sports).values({ code: "nrl", name: "QA NRL" }).returning())[0];
  const existingAfl = (await db.select().from(schema.sports).where(eq(schema.sports.code, "afl")))[0];
  const aflWasCreatedByThisRun = !existingAfl;
  const afl = existingAfl ?? (await db.insert(schema.sports).values({ code: "afl", name: "QA AFL" }).returning())[0];

  // Defensive pre-flight: remove any orphaned QA seasons left by a previous crashed run at
  // the same fixed (sportId, year=2099) pairs, now that the sport rows are reused.
  for (const [sport, label] of [
    [nrl, `${MARK}-nrl-season`],
    [afl, `${MARK}-afl-season`],
  ] as const) {
    const orphaned = (await db.select().from(schema.seasons).where(and(eq(schema.seasons.sportId, sport.id), eq(schema.seasons.year, 2099))))[0];
    if (orphaned?.label === label) {
      console.log(`Pre-flight: removing an orphaned QA season from a previous run (id=${orphaned.id}).`);
      const orphanedRounds = await db.select().from(schema.rounds).where(eq(schema.rounds.seasonId, orphaned.id));
      for (const r of orphanedRounds) {
        const orphanedComps = await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, r.id));
        for (const c of orphanedComps) {
          const orphanedEntries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, c.id));
          for (const e of orphanedEntries) await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, e.id));
          await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, c.id));
          await db.delete(schema.competitions).where(eq(schema.competitions.id, c.id));
        }
        await db.delete(schema.games).where(eq(schema.games.roundId, r.id));
        await db.delete(schema.rounds).where(eq(schema.rounds.id, r.id));
      }
      await db.delete(schema.seasons).where(eq(schema.seasons.id, orphaned.id));
    }
  }

  const [nrlSeason] = await db.insert(schema.seasons).values({ sportId: nrl.id, year: 2099, label: `${MARK}-nrl-season` }).returning();
  const [aflSeason] = await db.insert(schema.seasons).values({ sportId: afl.id, year: 2099, label: `${MARK}-afl-season` }).returning();

  const [nrlHome] = await db.insert(schema.teams).values({ sportId: nrl.id, name: `${MARK}-nrl-home`, shortName: "QNH", slug: `${MARK}-nrl-home` }).returning();
  const [nrlAway] = await db.insert(schema.teams).values({ sportId: nrl.id, name: `${MARK}-nrl-away`, shortName: "QNA", slug: `${MARK}-nrl-away` }).returning();
  const [aflHome] = await db.insert(schema.teams).values({ sportId: afl.id, name: `${MARK}-afl-home`, shortName: "QAH", slug: `${MARK}-afl-home` }).returning();
  const [aflAway] = await db.insert(schema.teams).values({ sportId: afl.id, name: `${MARK}-afl-away`, shortName: "QAA", slug: `${MARK}-afl-away` }).returning();

  const userA = await registerUser(`${MARK}-a@perfect2.test`);
  const userB = await registerUser(`${MARK}-b@perfect2.test`);
  const userC = await registerUser(`${MARK}-c@perfect2.test`);

  const roundIds: number[] = [];
  const gameIds: number[] = [];
  const playerIds: number[] = [];
  const teamIds = [nrlHome.id, nrlAway.id, aflHome.id, aflAway.id];
  const userEmails = [`${MARK}-a@perfect2.test`, `${MARK}-b@perfect2.test`, `${MARK}-c@perfect2.test`];

  try {
    // ============================================================
    // NRL Round 1 — ONE winner, non-default prize (tests 1, 13, 14, 16, 17, 18, 19)
    // ============================================================
    const r1 = await seedRound(nrl.id, nrlSeason.id, 1, nrlHome.id, nrlAway.id);
    roundIds.push(r1.roundId);
    gameIds.push(r1.gameId);
    playerIds.push(r1.scorer1PlayerId, r1.scorer2PlayerId, r1.nonScorerPlayerId);

    const entryA1 = await api(`/api/nrl/rounds/${r1.roundId}/entries`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userA}` },
      body: JSON.stringify({ selections: [{ gameId: r1.gameId, player1Id: r1.scorer1PlayerId, player2Id: r1.scorer2PlayerId }] }),
    });
    assert(entryA1.status === 201, "seed: userA entry created in NRL round 1 (picks both real scorers -> will be perfect)");
    const entryB1 = await api(`/api/nrl/rounds/${r1.roundId}/entries`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userB}` },
      body: JSON.stringify({ selections: [{ gameId: r1.gameId, player1Id: r1.scorer1PlayerId, player2Id: r1.nonScorerPlayerId }] }),
    });
    // userB includes the non-scorer in one slot, so their entry can never go perfect —
    // only userA (who picked both real scorers) ends up perfect.
    assert(entryB1.status === 201, "seed: userB entry created in NRL round 1 (will end up not_perfect)");
    const compA1 = await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, r1.roundId));
    const competition1 = compA1[0];
    await db.update(schema.competitions).set({ prizeAmountCents: 5500 }).where(eq(schema.competitions.id, competition1.id)); // non-default prize (test 14)

    await finalizeGamePerfectPossible(r1, nrlHome.id, nrlAway.id, "tries");

    const nonAdminCloseAttempt = await api(`/api/admin/competitions/${competition1.id}/close`, { method: "POST", headers: { Authorization: `Bearer ${userA}` } });
    assert(nonAdminCloseAttempt.status === 403, "28. a normal (non-admin) user cannot close a competition via the admin API");

    const adminEmail = `${MARK}-admin@perfect2.test`;
    const adminToken = await registerUser(adminEmail);
    await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.email, adminEmail));
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };

    const realClose1 = await api(`/api/admin/competitions/${competition1.id}/close`, { method: "POST", headers: adminHeaders });
    assert(realClose1.status === 200, "admin closes NRL round 1 via the real close endpoint");

    // adversarial: fake prize/rollover/allocation in the settle request body — must be ignored
    const settle1 = await api(`/api/admin/competitions/${competition1.id}/settle`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ prizeAmountCents: 999999999, rolloverInCents: 999999, allocations: [{ entryId: 1, amountCents: 999999999 }] }),
    });
    assert(settle1.status === 200, "NRL round 1 settles");
    assert(settle1.body.data.summary.prize.currentPoolCents === 5500, "1/14. current pool uses the real configured 5500 prize, not the injected fake value");
    assert(settle1.body.data.summary.prize.winnerCount === 1, "1. exactly one perfect entry");
    assert(settle1.body.data.summary.prize.awardedAmountCents === 5500, "1. single winner awarded 100% of the pool");
    assert(settle1.body.data.summary.prize.rolloverOutCents === 0, "1. no rollover when there is a winner");

    const detail1 = await api(`/api/admin/competitions/${competition1.id}`, { headers: adminHeaders });
    assert(detail1.body.data.prizeAmountCents === 5500 && detail1.body.data.rolloverInCents === 0, "13. base(5500) + rollover(0) = current pool(5500)");
    assert(detail1.body.data.winnerCount === 1 && detail1.body.data.awardedAmountCents === 5500, "financial outcome persisted on the competition row");

    const entries1 = await api(`/api/admin/competitions/${competition1.id}/entries`, { headers: adminHeaders });
    const winningEntry = entries1.body.data.entries.find((e: { result: string }) => e.result === "perfect");
    assert(!!winningEntry && winningEntry.prizeAllocationCents === 5500, "1. the winning entry's allocation equals the full pool");

    // 16/17: settle again — must not double-award or double-roll
    const settle1Again = await api(`/api/admin/competitions/${competition1.id}/settle`, { method: "POST", headers: adminHeaders });
    assert(settle1Again.status === 200, "re-settle call succeeds (idempotent, not an error)");
    assert(settle1Again.body.data.summary.prize.awardedAmountCents === 5500, "16. re-settling does not double-award (still 5500, not 11000)");
    assert(settle1Again.body.data.summary.prize.rolloverOutCents === 0, "17. re-settling does not double-roll");

    // 18/19: allocations immutable, historical outcome unchanged
    const entries1Again = await api(`/api/admin/competitions/${competition1.id}/entries`, { headers: adminHeaders });
    const winningEntryAgain = entries1Again.body.data.entries.find((e: { result: string }) => e.result === "perfect");
    assert(winningEntryAgain.prizeAllocationCents === 5500, "18. winner allocation immutable after repeated settlement");
    const detail1Again = await api(`/api/admin/competitions/${competition1.id}`, { headers: adminHeaders });
    assert(
      detail1Again.body.data.awardedAmountCents === 5500 && detail1Again.body.data.winnerCount === 1,
      "19. historical prize outcome unchanged across repeated settlement calls",
    );

    // ============================================================
    // NRL Round 2 — ZERO winners (tests 6, 10, 22)
    // ============================================================
    const r2 = await seedRound(nrl.id, nrlSeason.id, 2, nrlHome.id, nrlAway.id);
    roundIds.push(r2.roundId);
    gameIds.push(r2.gameId);
    playerIds.push(r2.scorer1PlayerId, r2.scorer2PlayerId, r2.nonScorerPlayerId);
    await api(`/api/nrl/rounds/${r2.roundId}/entries`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userA}` },
      body: JSON.stringify({ selections: [{ gameId: r2.gameId, player1Id: r2.scorer1PlayerId, player2Id: r2.scorer2PlayerId }] }),
    });
    // Finalize with NOBODY scoring (including the "scorer" players) -> not_perfect for everyone.
    await finalizeGameNoOneScores(r2, nrlHome.id, nrlAway.id);
    const comp2Rows = await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, r2.roundId));
    const competition2 = comp2Rows[0];
    await db.update(schema.competitions).set({ status: "closed", prizeAmountCents: 6000 }).where(eq(schema.competitions.id, competition2.id));

    const settle2 = await api(`/api/admin/competitions/${competition2.id}/settle`, { method: "POST", headers: adminHeaders });
    assert(settle2.status === 200, "NRL round 2 settles");
    assert(settle2.body.data.summary.prize.winnerCount === 0, "6. zero perfect entries");
    assert(settle2.body.data.summary.prize.awardedAmountCents === 0, "6. nothing awarded with zero winners");
    assert(settle2.body.data.summary.prize.rolloverOutCents === 6000, "6. the entire pool becomes rollover");

    const detail2 = await api(`/api/admin/competitions/${competition2.id}`, { headers: adminHeaders });
    assert(detail2.body.data.rolloverOutCents === 6000, "10. rollover recorded on round 2 even though round 3 doesn't exist yet");

    // 22: negative prize is rejected, not silently accepted
    const [corruptRound] = await db.insert(schema.rounds).values({ seasonId: nrlSeason.id, roundNumber: 99, name: `${MARK}-corrupt-round` }).returning();
    roundIds.push(corruptRound.id);
    const [corruptGame] = await db.insert(schema.games).values({ roundId: corruptRound.id, homeTeamId: nrlHome.id, awayTeamId: nrlAway.id, status: "final", homeScore: 0, awayScore: 0 }).returning();
    gameIds.push(corruptGame.id);
    const [corruptComp] = await db.insert(schema.competitions).values({ sportId: nrl.id, roundId: corruptRound.id, name: `${MARK}-corrupt`, prizeAmountCents: -500, status: "closed" }).returning();
    const settleCorrupt = await api(`/api/admin/competitions/${corruptComp.id}/settle`, { method: "POST", headers: adminHeaders });
    assert(settleCorrupt.status !== 200 || settleCorrupt.body.data?.summary?.prize === null, "22. a negative configured prize does not silently produce a negative-safe outcome — settlement rejects/errors instead of succeeding normally");
    await db.delete(schema.games).where(eq(schema.games.id, corruptGame.id));
    await db.delete(schema.competitions).where(eq(schema.competitions.id, corruptComp.id));

    // ============================================================
    // NRL Round 3 — created AFTER round 2 settled (tests 7, 11)
    // ============================================================
    const r3 = await seedRound(nrl.id, nrlSeason.id, 3, nrlHome.id, nrlAway.id);
    roundIds.push(r3.roundId);
    gameIds.push(r3.gameId);
    playerIds.push(r3.scorer1PlayerId, r3.scorer2PlayerId, r3.nonScorerPlayerId);
    const entryC3 = await api(`/api/nrl/rounds/${r3.roundId}/entries`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userC}` },
      body: JSON.stringify({ selections: [{ gameId: r3.gameId, player1Id: r3.scorer1PlayerId, player2Id: r3.scorer2PlayerId }] }),
    });
    assert(entryC3.status === 201, "seed: entry created in NRL round 3 (this creates round 3's competition row for the first time)");
    const comp3Rows = await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, r3.roundId));
    const competition3 = comp3Rows[0];
    assert(competition3.rolloverInCents === 6000, "7/11. round 3's competition pulled round 2's 6000 rollover the moment it was created");

    // Settle round 3 with ONE winner (userC) to confirm the pool includes the rollover
    await finalizeGamePerfectPossible(r3, nrlHome.id, nrlAway.id, "tries");
    await db.update(schema.competitions).set({ status: "closed", prizeAmountCents: 6000 }).where(eq(schema.competitions.id, competition3.id));
    const settle3 = await api(`/api/admin/competitions/${competition3.id}/settle`, { method: "POST", headers: adminHeaders });
    assert(settle3.body.data.summary.prize.currentPoolCents === 12000, "7. current pool = 6000 base + 6000 rollover = 12000");
    assert(settle3.body.data.summary.prize.awardedAmountCents === 12000, "7. winner receives the full rolled-in pool");

    // ============================================================
    // NRL Round 4 — zero winners again, then a LATER round 5 pulls it (tests 12, 24)
    // ============================================================
    const r4 = await seedRound(nrl.id, nrlSeason.id, 4, nrlHome.id, nrlAway.id);
    roundIds.push(r4.roundId);
    gameIds.push(r4.gameId);
    playerIds.push(r4.scorer1PlayerId, r4.scorer2PlayerId, r4.nonScorerPlayerId);
    await api(`/api/nrl/rounds/${r4.roundId}/entries`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userA}` },
      body: JSON.stringify({ selections: [{ gameId: r4.gameId, player1Id: r4.scorer1PlayerId, player2Id: r4.scorer2PlayerId }] }),
    });
    await finalizeGameNoOneScores(r4, nrlHome.id, nrlAway.id);
    const comp4Rows = await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, r4.roundId));
    const competition4 = comp4Rows[0];
    await db.update(schema.competitions).set({ status: "closed", prizeAmountCents: 6000 }).where(eq(schema.competitions.id, competition4.id));
    const settle4 = await api(`/api/admin/competitions/${competition4.id}/settle`, { method: "POST", headers: adminHeaders });
    assert(settle4.body.data.summary.prize.rolloverOutCents === 6000, "round 4 (no rollover in) rolls its own 6000 pool over");

    // 24: no round 5 exists yet in this season -> rollover must NOT disappear, must NOT
    // leak into a different sport/season, and rolloverClaimed must stay false.
    const detail4 = await api(`/api/admin/competitions/${competition4.id}`, { headers: adminHeaders });
    assert(detail4.body.data.rolloverOutCents === 6000, "24. end-of-season-so-far rollover preserved on the settled row");
    const raw4 = await db.select().from(schema.competitions).where(eq(schema.competitions.id, competition4.id));
    assert(raw4[0].rolloverClaimed === false, "24. rollover not falsely marked claimed when there's nowhere for it to go yet");

    // Now create round 5 -> should pull round 4's rollover, demonstrating accumulation
    // across 3 consecutive zero/rollover-involving settlements (round2 -> round3 already
    // spent it via a winner, so this is a fresh chain: round4 -> round5).
    const r5 = await seedRound(nrl.id, nrlSeason.id, 5, nrlHome.id, nrlAway.id);
    roundIds.push(r5.roundId);
    gameIds.push(r5.gameId);
    playerIds.push(r5.scorer1PlayerId, r5.scorer2PlayerId, r5.nonScorerPlayerId);
    await api(`/api/nrl/rounds/${r5.roundId}/entries`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userA}` },
      body: JSON.stringify({ selections: [{ gameId: r5.gameId, player1Id: r5.scorer1PlayerId, player2Id: r5.scorer2PlayerId }] }),
    });
    const comp5Rows = await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, r5.roundId));
    const competition5 = comp5Rows[0];
    assert(competition5.rolloverInCents === 6000, "12. round 5 pulled round 4's 6000 rollover on creation");
    const raw4Again = await db.select().from(schema.competitions).where(eq(schema.competitions.id, competition4.id));
    assert(raw4Again[0].rolloverClaimed === true, "rollover marked claimed exactly once it's actually pulled");

    // ============================================================
    // AFL — completely independent, multi-winner odd-cent split (tests 2, 3, 4, 5, 8, 9, 15, 23)
    // ============================================================
    const [aflR1] = await db.insert(schema.rounds).values({ seasonId: aflSeason.id, roundNumber: 1, name: `${MARK}-afl-round-1` }).returning();
    roundIds.push(aflR1.id);
    const [aflGame] = await db.insert(schema.games).values({ roundId: aflR1.id, homeTeamId: aflHome.id, awayTeamId: aflAway.id, kickoff: new Date(Date.now() + 86400000), status: "scheduled" }).returning();
    gameIds.push(aflGame.id);
    const [aflP1] = await db.insert(schema.players).values({ sportId: afl.id, teamId: aflHome.id, firstName: "QA", lastName: "AflWinner1" }).returning();
    const [aflP2] = await db.insert(schema.players).values({ sportId: afl.id, teamId: aflAway.id, firstName: "QA", lastName: "AflWinner2" }).returning();
    playerIds.push(aflP1.id, aflP2.id);
    await db.insert(schema.gameLineups).values([
      { gameId: aflGame.id, teamId: aflHome.id, playerId: aflP1.id, position: "Forward" },
      { gameId: aflGame.id, teamId: aflAway.id, playerId: aflP2.id, position: "Forward" },
    ]);
    // 3 users each pick BOTH aflP1 and aflP2 -> all 3 perfect (both score) -> odd-cent split test
    const aflUserD = `${MARK}-afld@perfect2.test`;
    const aflTokenD = await registerUser(aflUserD);
    for (const token of [userA, userB, aflTokenD]) {
      await api(`/api/afl/rounds/${aflR1.id}/entries`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ selections: [{ gameId: aflGame.id, player1Id: aflP1.id, player2Id: aflP2.id }] }),
      });
    }
    await db.update(schema.games).set({ status: "final", homeScore: 60, awayScore: 58 }).where(eq(schema.games.id, aflGame.id));
    await db.insert(schema.playerGameStats).values([
      { gameId: aflGame.id, playerId: aflP1.id, teamId: aflHome.id, tries: 0, goals: 1 },
      { gameId: aflGame.id, playerId: aflP2.id, teamId: aflAway.id, tries: 0, goals: 1 },
    ]);
    const aflCompRows = await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, aflR1.id));
    const aflCompetition = aflCompRows[0];
    await db.update(schema.competitions).set({ status: "closed", prizeAmountCents: 10001, entryFeeCents: 750 }).where(eq(schema.competitions.id, aflCompetition.id)); // odd pool + non-default fee (test 15)
    const settleAfl = await api(`/api/admin/competitions/${aflCompetition.id}/settle`, { method: "POST", headers: adminHeaders });
    assert(settleAfl.body.data.summary.prize.winnerCount === 3, "3. three perfect entries in AFL");
    assert(settleAfl.body.data.summary.prize.awardedAmountCents === 10001, "4/5. odd-cent pool (10001) fully awarded, no cent lost");
    const aflEntries = await api(`/api/admin/competitions/${aflCompetition.id}/entries`, { headers: adminHeaders });
    const aflAllocations = aflEntries.body.data.entries.map((e: { prizeAllocationCents: number }) => e.prizeAllocationCents).sort((a: number, b: number) => a - b);
    assert(JSON.stringify(aflAllocations) === JSON.stringify([3333, 3334, 3334]), `2/3/4. AFL odd-cent split correct: ${JSON.stringify(aflAllocations)}`);
    assert(aflAllocations.reduce((s: number, n: number) => s + n, 0) === 10001, "5. total allocations equal the prize pool exactly");

    // 8/9/23: NRL and AFL rollover never cross
    const aflDetailAfter = await api(`/api/admin/competitions/${aflCompetition.id}`, { headers: adminHeaders });
    assert(aflDetailAfter.body.data.rolloverInCents === 0, "8/9. AFL competition never received any of NRL's rollover activity");
    const nrlR5DetailFinal = await api(`/api/admin/competitions/${competition5.id}`, { headers: adminHeaders });
    assert(nrlR5DetailFinal.body.data.rolloverInCents === 6000, "8/9. NRL round 5's rollover unaffected by AFL settling independently");
    assert(true, "23. NRL and AFL isolation holds across the full test run (see all rolloverInCents assertions above)");

    // ============================================================
    // 25: concurrent settlement cannot duplicate financial outcomes
    // ============================================================
    await db.update(schema.competitions).set({ status: "closed" }).where(eq(schema.competitions.id, competition5.id));
    await finalizeGamePerfectPossible(r5, nrlHome.id, nrlAway.id, "tries");
    const [concurrentA, concurrentB] = await Promise.all([
      api(`/api/admin/competitions/${competition5.id}/settle`, { method: "POST", headers: adminHeaders }),
      api(`/api/admin/competitions/${competition5.id}/settle`, { method: "POST", headers: adminHeaders }),
    ]);
    assert(concurrentA.status === 200 && concurrentB.status === 200, "25. both concurrent settle requests complete successfully");
    assert(
      concurrentA.body.data.summary.prize.awardedAmountCents === concurrentB.body.data.summary.prize.awardedAmountCents,
      "25. concurrent settlement produces the same awarded amount, not a doubled one",
    );
    const finalEntries5 = await api(`/api/admin/competitions/${competition5.id}/entries`, { headers: adminHeaders });
    const totalAllocated5 = finalEntries5.body.data.entries.reduce((s: number, e: { prizeAllocationCents: number }) => s + e.prizeAllocationCents, 0);
    assert(totalAllocated5 === concurrentA.body.data.summary.prize.awardedAmountCents, "25. total per-entry allocations match the awarded amount exactly — no duplicate allocation from the race");

    // 20/21: invariants hold everywhere we've settled
    for (const compId of [competition1.id, competition2.id, competition3.id, competition4.id, competition5.id, aflCompetition.id]) {
      const d = await api(`/api/admin/competitions/${compId}`, { headers: adminHeaders });
      assert(d.body.data.awardedAmountCents <= d.body.data.currentPrizePoolCents, `20. awarded never exceeds pool for competition ${compId}`);
      assert(d.body.data.rolloverOutCents <= d.body.data.currentPrizePoolCents, `21. rollover never exceeds pool for competition ${compId}`);
      assert(d.body.data.awardedAmountCents + d.body.data.rolloverOutCents === d.body.data.currentPrizePoolCents, `invariant: awarded+rollover=pool for competition ${compId}`);
    }

    console.log(`=== ALL PHASE 19 PRIZE-POOL CHECKS PASSED (${passCount}) ===`);
  } finally {
    console.log("Cleaning up QA data...");
    const allCompetitions = await db.select().from(schema.competitions).where(inArray(schema.competitions.roundId, roundIds));
    for (const c of allCompetitions) {
      const entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, c.id));
      for (const e of entries) await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, e.id));
      await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, c.id));
    }
    await db.delete(schema.competitions).where(inArray(schema.competitions.roundId, roundIds));
    if (gameIds.length) {
      await db.delete(schema.playerGameStats).where(inArray(schema.playerGameStats.gameId, gameIds));
      await db.delete(schema.gameLineups).where(inArray(schema.gameLineups.gameId, gameIds));
      await db.delete(schema.games).where(inArray(schema.games.id, gameIds));
    }
    if (playerIds.length) await db.delete(schema.players).where(inArray(schema.players.id, playerIds));
    await db.delete(schema.teams).where(inArray(schema.teams.id, teamIds));
    await db.delete(schema.rounds).where(inArray(schema.rounds.id, roundIds));
    await db.delete(schema.seasons).where(inArray(schema.seasons.id, [nrlSeason.id, aflSeason.id]));
    const sportsToDelete = [nrlWasCreatedByThisRun ? nrl.id : null, aflWasCreatedByThisRun ? afl.id : null].filter((id): id is number => id !== null);
    if (sportsToDelete.length) await db.delete(schema.sports).where(inArray(schema.sports.id, sportsToDelete));

    const allEmails = [...userEmails, `${MARK}-admin@perfect2.test`, `${MARK}-afld@perfect2.test`];
    const userRows = await db.select().from(schema.users).where(inArray(schema.users.email, allEmails));
    const userIds = userRows.map((u) => u.id);
    if (userIds.length) {
      await db.delete(schema.sessions).where(inArray(schema.sessions.userId, userIds));
      await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    }
    console.log("Cleanup complete.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
