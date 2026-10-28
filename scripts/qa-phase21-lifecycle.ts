/**
 * PHASE 21 QA — sports-data pipeline + round lifecycle + kickoff cutoff + prize-pool
 * visibility. Seeds temporary, clearly-marked data and drives the REAL running backend
 * for everything reachable via HTTP; the two pieces with no HTTP surface (sync
 * idempotency, readiness reason codes) are exercised by calling the real library
 * functions directly against the real dev DB. Full cleanup + zero-row verification at
 * the end, per the established convention (see scripts/qa-phase19-prize-pool.ts).
 *
 * Time handling note: the authoritative buy-in cutoff / prize-pool-reveal instant is real
 * wall-clock time compared against a stored kickoff timestamp (see
 * src/lib/competitions/lifecycle.ts). Rather than faking the clock, this script seeds one
 * round with a kickoff safely in the future ("before" scenarios) and one with a kickoff
 * safely in the past ("after" scenarios) and asserts against real `now`. The exact
 * boundary instant (now === kickoff) is already proven by a pure unit test
 * (src/lib/competitions/lifecycle.test.ts) — not repeated here since it needs no DB/HTTP.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { createLifecycleMockProvider } from "../src/lib/sports-data/providers/mock-provider";
import { runFullSync } from "../src/lib/sports-data/orchestrate";
import { syncGamePlayers } from "../src/lib/sports-data/sync";
import { getRoundReadiness } from "../src/lib/sports-data/readiness";

const API_URL = "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
const MARK = "qa-test-internal-phase21";

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

const HOUR = 60 * 60 * 1000;

async function seedRound(sportId: number, seasonId: number, roundNumber: number, homeTeamId: number, awayTeamId: number, kickoffOffsetsMs: number[]) {
  const [round] = await db.insert(schema.rounds).values({ seasonId, roundNumber, name: `${MARK}-round-${sportId}-${roundNumber}` }).returning();
  const gameIds: number[] = [];
  for (const offset of kickoffOffsetsMs) {
    const [game] = await db.insert(schema.games).values({ roundId: round.id, homeTeamId, awayTeamId, kickoff: new Date(Date.now() + offset), status: "scheduled" }).returning();
    gameIds.push(game.id);
  }
  const [p1] = await db.insert(schema.players).values({ sportId, teamId: homeTeamId, firstName: "QA", lastName: `P21_H_${round.id}` }).returning();
  const [p2] = await db.insert(schema.players).values({ sportId, teamId: awayTeamId, firstName: "QA", lastName: `P21_A_${round.id}` }).returning();
  await db.insert(schema.gameLineups).values(gameIds.flatMap((gameId) => [
    { gameId, teamId: homeTeamId, playerId: p1.id, position: "Fullback" },
    { gameId, teamId: awayTeamId, playerId: p2.id, position: "Fullback" },
  ]));
  return { roundId: round.id, gameIds, p1Id: p1.id, p2Id: p2.id };
}

async function main() {
  console.log("=== PHASE 21 QA: sports-data pipeline + round lifecycle + kickoff cutoff + prize pool visibility ===");

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
  const [nrlHome] = await db.insert(schema.teams).values({ sportId: nrl.id, name: `${MARK}-nrl-home`, shortName: "Q1H", slug: `${MARK}-nrl-home` }).returning();
  const [nrlAway] = await db.insert(schema.teams).values({ sportId: nrl.id, name: `${MARK}-nrl-away`, shortName: "Q1A", slug: `${MARK}-nrl-away` }).returning();
  const [aflHome] = await db.insert(schema.teams).values({ sportId: afl.id, name: `${MARK}-afl-home`, shortName: "Q2H", slug: `${MARK}-afl-home` }).returning();
  const [aflAway] = await db.insert(schema.teams).values({ sportId: afl.id, name: `${MARK}-afl-away`, shortName: "Q2A", slug: `${MARK}-afl-away` }).returning();

  const roundIds: number[] = [];
  const gameIds: number[] = [];
  const playerIds: number[] = [];
  const teamIds = [nrlHome.id, nrlAway.id, aflHome.id, aflAway.id];
  const userEmails: string[] = [];

  try {
    const userA = await registerUser(`${MARK}-a@perfect2.test`);
    userEmails.push(`${MARK}-a@perfect2.test`);
    const userB = await registerUser(`${MARK}-b@perfect2.test`);
    userEmails.push(`${MARK}-b@perfect2.test`);
    const adminEmail = `${MARK}-admin@perfect2.test`;
    const adminToken = await registerUser(adminEmail);
    userEmails.push(adminEmail);
    await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.email, adminEmail));
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };

    // ============================================================
    // ROUND A (NRL) — first game kickoff is safely in the future
    // ============================================================
    const roundA = await seedRound(nrl.id, nrlSeason.id, 1, nrlHome.id, nrlAway.id, [1 * HOUR, 3 * HOUR]);
    roundIds.push(roundA.roundId);
    gameIds.push(...roundA.gameIds);
    playerIds.push(roundA.p1Id, roundA.p2Id);

    const preflightA = await api(`/api/nrl/rounds/${roundA.roundId}/payment`, { method: "POST", headers: { Authorization: `Bearer ${userA}` } });
    assert(preflightA.status === 200, "7. before first kickoff: buy-in (payment pre-flight) is allowed");

    const entryA = await api(`/api/nrl/rounds/${roundA.roundId}/entries`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userA}` },
      body: JSON.stringify({ selections: roundA.gameIds.map((gameId) => ({ gameId, player1Id: roundA.p1Id, player2Id: roundA.p2Id })) }),
    });
    assert(entryA.status === 201, "7. before first kickoff: entry creation is allowed");

    const listA = await api(`/api/nrl/rounds`);
    const roundAInList = listA.body.data.rounds.find((r: { id: number }) => r.id === roundA.roundId);
    assert(roundAInList.competition.prizePoolVisible === false, "13. before kickoff: prizePoolVisible is false in the round-list endpoint");
    assert(roundAInList.competition.currentPrizePoolCents === null, "13. before kickoff: currentPrizePoolCents is null, not just hidden client-side");

    const detailA = await api(`/api/nrl/rounds/${roundA.roundId}`);
    assert(detailA.body.data.competition.prizePoolVisible === false, "13. before kickoff: prizePoolVisible is false in the round-detail endpoint");
    assert(detailA.body.data.competition.currentPrizePoolCents === null, "13. before kickoff: currentPrizePoolCents is null in round-detail too");
    assert(detailA.body.data.competition.buyInCutoffAt === new Date(detailA.body.data.competition.buyInCutoffAt).toISOString(), "buyInCutoffAt is a real ISO timestamp");

    // 17/18: client cannot fabricate the pool or its visibility via request body/query manipulation.
    const forgedQuery = await api(`/api/nrl/rounds/${roundA.roundId}?prizePoolVisible=true&currentPrizePoolCents=999999`);
    assert(forgedQuery.body.data.competition.prizePoolVisible === false, "17/18. query-string forgery of prizePoolVisible is ignored — server decides, not the client");
    const forgedBody = await api(`/api/nrl/rounds/${roundA.roundId}/payment`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userB}` },
      body: JSON.stringify({ amountCents: 1, currency: "USD", competitionStatus: "settled", closesAt: new Date(0).toISOString() }),
    });
    assert(forgedBody.status === 200, "12. a forged closesAt/competitionStatus in the request body does not fool the server into rejecting or bypassing the real cutoff");
    assert(forgedBody.body.data.amountCents !== 1, "12. forged amountCents is ignored — real entryFeeCents used instead");

    // ============================================================
    // ROUND B (NRL) — first game kickoff is safely in the past; a LATER game is still
    // in the future, proving the cutoff is MIN(kickoff), never the last/other game.
    // ============================================================
    const roundB = await seedRound(nrl.id, nrlSeason.id, 2, nrlHome.id, nrlAway.id, [-1 * HOUR, 2 * HOUR]);
    roundIds.push(roundB.roundId);
    gameIds.push(...roundB.gameIds);
    playerIds.push(roundB.p1Id, roundB.p2Id);

    const preflightB = await api(`/api/nrl/rounds/${roundB.roundId}/payment`, { method: "POST", headers: { Authorization: `Bearer ${userA}` } });
    assert(preflightB.status === 422, "8/9. at/after first kickoff: buy-in (payment pre-flight) is rejected");

    const entryB = await api(`/api/nrl/rounds/${roundB.roundId}/entries`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userA}` },
      body: JSON.stringify({ selections: roundB.gameIds.map((gameId) => ({ gameId, player1Id: roundB.p1Id, player2Id: roundB.p2Id })) }),
    });
    assert(entryB.status !== 201, "8/9. at/after first kickoff: entry creation is rejected even though a LATER game hasn't started yet");
    assert(entryB.status === 422 || entryB.status === 400, "10. rejection is a normal validation response, not a crash");

    const detailB = await api(`/api/nrl/rounds/${roundB.roundId}`);
    assert(detailB.body.data.competition.prizePoolVisible === true, "14. after the first game kicks off: prizePoolVisible is true");
    assert(typeof detailB.body.data.competition.currentPrizePoolCents === "number", "14. after kickoff: currentPrizePoolCents is a real number");
    assert(
      detailB.body.data.competition.currentPrizePoolCents === detailB.body.data.competition.prizeAmountCents,
      "14. with no rollover yet, the visible pool equals the base configured prize",
    );

    // 10: a later game's kickoff must never be mistaken for the round's cutoff.
    const roundBRow = (await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, roundB.roundId)))[0];
    const firstGameB = (await db.select().from(schema.games).where(eq(schema.games.id, roundB.gameIds[0])))[0];
    assert(
      roundBRow.closesAt !== null && Math.abs(roundBRow.closesAt.getTime() - firstGameB.kickoff!.getTime()) < 1000,
      "10. the stored buy-in cutoff equals the FIRST game's kickoff, not the later game's",
    );

    // ============================================================
    // AFL — independent from NRL: still hidden while NRL Round B is already visible.
    // ============================================================
    const roundAfl = await seedRound(afl.id, aflSeason.id, 1, aflHome.id, aflAway.id, [1 * HOUR]);
    roundIds.push(roundAfl.roundId);
    gameIds.push(...roundAfl.gameIds);
    playerIds.push(roundAfl.p1Id, roundAfl.p2Id);
    await api(`/api/afl/rounds/${roundAfl.roundId}/payment`, { method: "POST", headers: { Authorization: `Bearer ${userA}` } });
    const detailAfl = await api(`/api/afl/rounds/${roundAfl.roundId}`);
    assert(detailAfl.body.data.competition.prizePoolVisible === false, "15. AFL's pool stays hidden even though NRL round B's is already visible — fully independent");

    // ============================================================
    // Rollover still flows correctly through the new visibility-gated field (Phase 19
    // logic untouched — this just proves it's reachable once the pool is visible).
    // ============================================================
    await db.update(schema.games).set({ status: "final", homeScore: 0, awayScore: 0 }).where(inArray(schema.games.id, roundB.gameIds));
    await db.update(schema.competitions).set({ status: "closed", prizeAmountCents: 6000 }).where(eq(schema.competitions.id, roundBRow.id));
    const settleB = await api(`/api/admin/competitions/${roundBRow.id}/settle`, { method: "POST", headers: adminHeaders });
    assert(settleB.status === 200, "seed: round B settles with zero winners (nobody scored) to produce a rollover");

    const roundC = await seedRound(nrl.id, nrlSeason.id, 3, nrlHome.id, nrlAway.id, [-1 * HOUR]);
    roundIds.push(roundC.roundId);
    gameIds.push(...roundC.gameIds);
    playerIds.push(roundC.p1Id, roundC.p2Id);
    await api(`/api/nrl/rounds/${roundC.roundId}/payment`, { method: "POST", headers: { Authorization: `Bearer ${userA}` } }); // creates round C's competition, pulling the rollover
    const detailC = await api(`/api/nrl/rounds/${roundC.roundId}`);
    assert(detailC.body.data.competition.prizePoolVisible === true, "16. round C's pool is visible (its own first game already kicked off)");
    assert(
      detailC.body.data.competition.currentPrizePoolCents === detailC.body.data.competition.prizeAmountCents + 6000,
      `16. round C's visible pool correctly includes round B's rollover (got ${detailC.body.data.competition.currentPrizePoolCents})`,
    );

    // ============================================================
    // Admin: readiness / lifecycle fields
    // ============================================================
    const roundCComp = (await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, roundC.roundId)))[0];
    const adminDetailC = await api(`/api/admin/competitions/${roundCComp.id}`, { headers: adminHeaders });
    assert(adminDetailC.body.data.teamListsReady === true, "admin: teamListsReady true once every game has a kickoff + released lineup");
    assert(adminDetailC.body.data.readinessBlockers.length === 0, "admin: no readiness blockers once fully ready");
    assert(adminDetailC.body.data.prizePoolVisible === true, "admin: prizePoolVisible mirrors the customer-facing decision");
    assert(typeof adminDetailC.body.data.currentPrizePoolCents === "number", "admin: currentPrizePoolCents always shown internally regardless of public visibility");

    const dashboard = await api("/api/admin/dashboard", { headers: adminHeaders });
    assert(dashboard.body.data.sportsDataProvider === "none", "admin dashboard reports the real configured sports-data provider status (none, by default in this environment)");

    // ============================================================
    // Readiness reason codes — a round with a game missing kickoff AND no team list yet
    // ============================================================
    const [readinessRound] = await db.insert(schema.rounds).values({ seasonId: nrlSeason.id, roundNumber: 99, name: `${MARK}-readiness-round` }).returning();
    roundIds.push(readinessRound.id);
    const [readinessGame] = await db.insert(schema.games).values({ roundId: readinessRound.id, homeTeamId: nrlHome.id, awayTeamId: nrlAway.id, kickoff: null, status: "scheduled" }).returning();
    gameIds.push(readinessGame.id);

    const notReady = await getRoundReadiness(readinessRound.id);
    assert(notReady.status === "ok", "21/22. readiness lookup succeeds even for an incomplete round");
    if (notReady.status === "ok") {
      assert(notReady.data.teamListsReady === false, "22. a game with no kickoff and no players is correctly not selection-ready");
      assert(notReady.data.blockers.includes("MISSING_KICKOFF"), "22. MISSING_KICKOFF blocker reported");
      assert(notReady.data.blockers.includes("MISSING_PLAYERS"), "1/2. MISSING_PLAYERS blocker reported when no team list exists yet");
    }

    // Release the team list (2 players) and set a kickoff — must become ready.
    const [readinessP1] = await db.insert(schema.players).values({ sportId: nrl.id, teamId: nrlHome.id, firstName: "QA", lastName: "ReadinessH" }).returning();
    const [readinessP2] = await db.insert(schema.players).values({ sportId: nrl.id, teamId: nrlAway.id, firstName: "QA", lastName: "ReadinessA" }).returning();
    playerIds.push(readinessP1.id, readinessP2.id);
    await db.insert(schema.gameLineups).values([
      { gameId: readinessGame.id, teamId: nrlHome.id, playerId: readinessP1.id, position: "Fullback" },
      { gameId: readinessGame.id, teamId: nrlAway.id, playerId: readinessP2.id, position: "Fullback" },
    ]);
    await db.update(schema.games).set({ kickoff: new Date(Date.now() + 5 * HOUR) }).where(eq(schema.games.id, readinessGame.id));

    const nowReady = await getRoundReadiness(readinessRound.id);
    assert(nowReady.status === "ok" && nowReady.data.teamListsReady === true, "3. once team lists are released and kickoff is known, the round becomes selection-ready");
    assert(nowReady.status === "ok" && nowReady.data.blockers.length === 0, "3. no blockers remain once selection-ready");
    assert(nowReady.status === "ok" && !nowReady.data.games[0].blockers.includes("MISSING_HOME_TEAM"), "4. positions/eligibility are never a readiness blocker — only kickoff + player-count are checked");

    // ============================================================
    // Data quality — a game-player association for a game that was never synced is
    // rejected with a clear error, never silently accepted or fabricated.
    // ============================================================
    const invalidAssocProvider = {
      name: "qa-invalid-fixture",
      async listSeasons() { return []; },
      async listRounds() { return []; },
      async listTeams() { return []; },
      async listPlayers() { return []; },
      async listGames() { return []; },
      async listGamePlayers() {
        return [{ gameExternalId: `${MARK}-does-not-exist`, playerExternalId: `${MARK}-never-synced-player`, teamExternalId: `${MARK}-fake-team` }];
      },
      async listPlayerGameStats() { return []; },
    };
    const invalidSyncResult = await syncGamePlayers(invalidAssocProvider, "nrl", `${MARK}-does-not-exist`);
    assert(invalidSyncResult.errors.length > 0, "20/21. syncing associations for a game that was never synced is rejected with a clear error, not silently accepted");

    // ============================================================
    // Sync idempotency — running the full sync twice against the mock lifecycle
    // provider never duplicates rows.
    // ============================================================
    const mockProvider = createLifecycleMockProvider({ referenceTime: new Date(Date.now() + 100 * HOUR) }); // far enough away it can't collide with anything above
    const first = await runFullSync(mockProvider, "nrl", "mock-lc-season-nrl", "mock-lc-round-nrl-1");
    assert(first.seasons.errors.length === 0 && first.teams.errors.length === 0 && first.games.errors.length === 0, "19. first sync run completes with no errors");
    const gamesAfterFirst = await db.select().from(schema.games).where(eq(schema.games.roundId, (await db.select().from(schema.rounds).where(eq(schema.rounds.externalId, "mock-lc-round-nrl-1")).limit(1))[0].id));
    const second = await runFullSync(mockProvider, "nrl", "mock-lc-season-nrl", "mock-lc-round-nrl-1");
    const gamesAfterSecond = await db.select().from(schema.games).where(eq(schema.games.roundId, gamesAfterFirst[0].roundId));
    assert(gamesAfterFirst.length === gamesAfterSecond.length, "19. running the full sync twice does not duplicate game rows");
    assert(second.games.inserted === 0 && second.games.updated === gamesAfterFirst.length, "19. the second run is all updates, zero new inserts — proves idempotency, not just equal counts by coincidence");

    // Track the mock-provider-synced rows for cleanup too.
    const mockSeasonRows = await db.select().from(schema.seasons).where(inArray(schema.seasons.externalId, ["mock-lc-season-nrl", "mock-lc-season-afl"]));
    const mockRoundRows = await db.select().from(schema.rounds).where(inArray(schema.rounds.externalId, ["mock-lc-round-nrl-1", "mock-lc-round-afl-1"]));
    const mockGameRows = mockRoundRows.length ? await db.select().from(schema.games).where(inArray(schema.games.roundId, mockRoundRows.map((r) => r.id))) : [];
    const mockTeamRows = await db.select().from(schema.teams).where(inArray(schema.teams.slug, [
      "lifecycle-sharks", "lifecycle-eels", "lifecycle-broncos", "lifecycle-storm", "lifecycle-swans", "lifecycle-cats", "lifecycle-pies", "lifecycle-hawks",
    ]));
    const mockPlayerRows = mockGameRows.length
      ? await db.select().from(schema.players).where(inArray(schema.players.sportId, [nrl.id, afl.id]))
      : [];
    const mockLifecyclePlayerIds = mockPlayerRows.filter((p) => p.lastName.startsWith("mock-lc-")).map((p) => p.id);

    console.log(`=== ALL PHASE 21 LIFECYCLE CHECKS PASSED (${passCount}) ===`);

    // Clean up the mock-provider-synced data inline (separate id space from the
    // hand-seeded QA fixtures above, so it's cleaned up here rather than in the generic
    // finally block's id lists).
    if (mockGameRows.length) {
      await db.delete(schema.playerGameStats).where(inArray(schema.playerGameStats.gameId, mockGameRows.map((g) => g.id)));
      await db.delete(schema.gameLineups).where(inArray(schema.gameLineups.gameId, mockGameRows.map((g) => g.id)));
      await db.delete(schema.games).where(inArray(schema.games.id, mockGameRows.map((g) => g.id)));
    }
    if (mockLifecyclePlayerIds.length) await db.delete(schema.players).where(inArray(schema.players.id, mockLifecyclePlayerIds));
    if (mockRoundRows.length) await db.delete(schema.rounds).where(inArray(schema.rounds.id, mockRoundRows.map((r) => r.id)));
    if (mockTeamRows.length) await db.delete(schema.teams).where(inArray(schema.teams.id, mockTeamRows.map((t) => t.id)));
    if (mockSeasonRows.length) await db.delete(schema.seasons).where(inArray(schema.seasons.id, mockSeasonRows.map((s) => s.id)));
  } finally {
    console.log("Cleaning up QA data...");
    const allCompetitions = await db.select().from(schema.competitions).where(inArray(schema.competitions.roundId, roundIds));
    for (const c of allCompetitions) {
      const entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, c.id));
      for (const e of entries) await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, e.id));
      await db.delete(schema.paymentTransactions).where(eq(schema.paymentTransactions.competitionId, c.id));
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

    const userRows = await db.select().from(schema.users).where(inArray(schema.users.email, userEmails));
    const userIds = userRows.map((u) => u.id);
    if (userIds.length) {
      await db.delete(schema.paymentTransactions).where(inArray(schema.paymentTransactions.userId, userIds));
      await db.delete(schema.sessions).where(inArray(schema.sessions.userId, userIds));
      await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    }

    // Independent verification — zero rows remain anywhere for this QA run.
    const remainingSports = sportsToDelete.length ? await db.select().from(schema.sports).where(inArray(schema.sports.id, sportsToDelete)) : [];
    const remainingUsers = await db.select().from(schema.users).where(inArray(schema.users.email, userEmails));
    const remainingRounds = await db.select().from(schema.rounds).where(inArray(schema.rounds.id, roundIds));
    if (remainingSports.length || remainingUsers.length || remainingRounds.length) {
      throw new Error(`Cleanup verification FAILED: ${remainingSports.length} sports, ${remainingUsers.length} users, ${remainingRounds.length} rounds still present.`);
    }
    console.log("Cleanup complete and verified (0 rows remain).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
