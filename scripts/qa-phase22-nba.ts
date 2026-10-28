/**
 * PHASE 22 QA — NBA as a genuinely real, live third sport + the generalized "admin
 * curates N games out of a larger real schedule" round-shape engine (which NRL/AFL now
 * also use for variable round sizes, e.g. a 6-game State of Origin week).
 *
 * Two halves:
 *  A. NBA — driven through the REAL running admin HTTP API against the REAL live ESPN
 *     data provider (no mock, no fabricated games/teams/players). Stats for the
 *     not-yet-played real games are written directly to the DB to exercise settlement
 *     (the games genuinely haven't happened yet — there is nothing to fake here, this is
 *     the same "seed the outcome directly" convention every other phase's QA script uses
 *     for settlement testing).
 *  B. NRL variable round size — the admin CURATION functions (schedule-pool.ts,
 *     round-shape.ts, sync.ts's syncProviderGamesIntoPool) called directly against the
 *     real dev DB using the labelled mock provider, since the admin HTTP sync route for
 *     NRL/AFL depends on the server process's own SPORTS_DATA_PROVIDER env var (which
 *     this script's separate process can't change without restarting the server) — the
 *     HTTP route itself is instead smoke-tested for its documented fail-safe behavior.
 *
 * Cleanup note: unlike other QA scripts, this one does NOT delete the real NBA
 * teams/players/season/schedule-pool games it syncs from the live provider — those are
 * genuine, reusable reference data (exactly what a real admin sync would produce), not
 * QA fixtures. Only the QA-created round/competition/entries/selections/stats/users are
 * removed, with zero-row verification on those specifically.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { createLifecycleMockProvider } from "../src/lib/sports-data/providers/mock-provider";
import { syncPlayerEligibilityForGames, syncProviderGamesIntoPool, syncSeasons, syncTeams } from "../src/lib/sports-data/sync";
import { getOrCreateSchedulePoolRound, listCandidateGames, createRound, assignCandidatesToRound } from "../src/lib/data/schedule-pool";
import { validateRoundShape } from "../src/lib/perfect2/round-shape";

const API_URL = "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
const MARK = "qa-test-internal-phase22";

/** apiUnavailable() (src/lib/api/response.ts) is reserved specifically for a caught, transient infra error (e.g. a Neon network blip) — it deliberately never leaks the real cause, but its generic message is a reliable signal that retrying is the correct response, unlike a genuine 4xx validation outcome. */
const TRANSIENT_UNAVAILABLE_MESSAGE = "Data is temporarily unavailable. Try again shortly.";

/** Retries on a transient network/timeout error OR the server's own "temporarily unavailable" signal — never on a real validation/business-rule HTTP response (those are legitimate test outcomes, not flakiness). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(path: string, init?: RequestInit, attempt = 1): Promise<{ status: number; body: any }> {
  try {
    const res = await fetch(`${API_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    const body = await res.json();
    if (res.status === 503 && body?.message === TRANSIENT_UNAVAILABLE_MESSAGE && attempt < 4) {
      console.log(`  (transient "unavailable" response on ${path}, attempt ${attempt}, retrying...)`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      return api(path, init, attempt + 1);
    }
    return { status: res.status, body };
  } catch (err) {
    if (attempt < 3) {
      console.log(`  (transient fetch error on ${path}, retrying: ${err instanceof Error ? err.message : err})`);
      await new Promise((r) => setTimeout(r, 3000));
      return api(path, init, attempt + 1);
    }
    throw err;
  }
}
/** Retries a direct DB call (bypassing the HTTP api() helper above) up to twice on a raw transient network exception from Neon's HTTP driver (e.g. "fetch failed") — the same class of infra blip api() already tolerates for HTTP calls, just for the direct-db-write parts of this script (settlement-outcome seeding). Never retries a real query/logic error. */
async function withDbRetry<T>(fn: () => Promise<T>, attempt = 1): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const isTransient = err instanceof Error && /fetch failed|ECONNRESET|ETIMEDOUT/i.test(err.message + (err.cause instanceof Error ? err.cause.message : ""));
    if (isTransient && attempt < 3) {
      console.log(`  (transient DB network error, attempt ${attempt}, retrying: ${err.message})`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      return withDbRetry(fn, attempt + 1);
    }
    throw err;
  }
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

async function main() {
  console.log("=== PHASE 22 QA: NBA (real live data) + configurable round-size engine ===");

  const userEmails: string[] = [];
  let nbaRoundId: number | undefined;
  let nbaCompetitionId: number | undefined;
  let nbaGameIds: number[] = [];
  const nbaStatRowGameIds: number[] = [];
  let nrlRoundId: number | undefined;
  const nrlTeamIds: number[] = [];
  const nrlPlayerIds: number[] = [];
  let nrlSportId: number | undefined;
  let nrlSeasonId: number | undefined;

  // Defensive pre-flight: if a previous run of this script died between successfully
  // creating a round and capturing its id (e.g. the HTTP response was lost to a genuine
  // network blip even though the server-side write committed), that round is permanently
  // orphaned — its fixed roundNumber (999/998) collides with rounds_season_number_unique
  // on every future run, forever, since normal cleanup only ever knows about IDs it
  // itself captured. Find and remove any such leftovers by name before asserting anything.
  const orphanedRounds = await db.select().from(schema.rounds).where(eq(schema.rounds.name, `${MARK}-nba-round`));
  for (const r of [...orphanedRounds, ...(await db.select().from(schema.rounds).where(eq(schema.rounds.name, `${MARK}-bad`)))]) {
    console.log(`Pre-flight: removing an orphaned round from a previous failed run (id=${r.id}, roundNumber=${r.roundNumber}).`);
    const comps = await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, r.id));
    for (const c of comps) {
      const entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, c.id));
      for (const e of entries) await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, e.id));
      await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, c.id));
      await db.delete(schema.competitions).where(eq(schema.competitions.id, c.id));
    }
    const poolRoundRows = await db.select().from(schema.rounds).where(and(eq(schema.rounds.seasonId, r.seasonId), eq(schema.rounds.isSchedulePool, true))).limit(1);
    if (poolRoundRows[0]) {
      await db.update(schema.games).set({ roundId: poolRoundRows[0].id, slotLabel: null }).where(eq(schema.games.roundId, r.id));
    }
    await db.delete(schema.rounds).where(eq(schema.rounds.id, r.id));
  }

  try {
    const adminEmail = `${MARK}-admin@perfect2.test`;
    const adminToken = await registerUser(adminEmail);
    userEmails.push(adminEmail);
    await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.email, adminEmail));
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };

    const userAEmail = `${MARK}-a@perfect2.test`;
    const userAToken = await registerUser(userAEmail);
    userEmails.push(userAEmail);

    // ============================================================
    // PART A — NBA: real live ESPN data, driven entirely through the real admin API
    // ============================================================
    const syncRes = await api("/api/admin/nba/sync-schedule", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ startDate: "2026-10-29", endDate: "2026-11-01" }),
    });
    assert(syncRes.status === 200, "A1. real NBA schedule sync succeeds against the live ESPN provider");
    assert(syncRes.body.data.games.inserted + syncRes.body.data.games.updated >= 8, "A1. at least 8 real games were synced for the window");
    const seasonId = syncRes.body.data.seasonId as number;

    const candidatesRes = await api(`/api/admin/rounds/candidates?sportCode=nba&startDate=2026-10-29&endDate=2026-11-01`, { headers: adminHeaders });
    assert(candidatesRes.status === 200, "A2. candidates endpoint returns real synced games");
    const candidates = candidatesRes.body.data.candidates as { gameId: number; homeTeamName: string; awayTeamName: string }[];
    assert(candidates.length >= 8, `A2. at least 8 real candidate games available (got ${candidates.length})`);
    assert(candidates.every((c) => c.homeTeamName !== "Unknown" && c.awayTeamName !== "Unknown"), "A2. every candidate has a real resolved team name — nothing fabricated");

    const slots = ["thursday", "thursday", "friday", "friday", "saturday", "saturday", "sunday", "sunday"];
    const chosen = candidates.slice(0, 8);
    const assignments = chosen.map((c, i) => ({ gameId: c.gameId, slotLabel: slots[i] }));
    nbaGameIds = chosen.map((c) => c.gameId);

    const createRoundRes = await api("/api/admin/rounds/create", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ sportCode: "nba", seasonId, roundNumber: 999, name: `${MARK}-nba-round`, startDate: "2026-10-29", endDate: "2026-11-01", assignments }),
    });
    assert(createRoundRes.status === 201, `A3. real NBA round created from 8 curated real games (${JSON.stringify(createRoundRes.body)})`);
    assert(createRoundRes.body.data.assigned === 8, "A3. exactly 8 games assigned");
    nbaRoundId = createRoundRes.body.data.roundId;

    const badAssignments = [{ gameId: chosen[0].gameId, slotLabel: "thursday" }];
    const badRoundRes = await api("/api/admin/rounds/create", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ sportCode: "nba", seasonId, roundNumber: 998, name: `${MARK}-bad`, startDate: "2026-10-29", endDate: "2026-11-01", assignments: badAssignments }),
    });
    assert(badRoundRes.status === 422, "A4. an NBA round with only 1 game (not 8) is rejected before anything is written");

    const roundDetailRes = await api(`/api/nba/rounds/${nbaRoundId}`);
    assert(roundDetailRes.status === 200, "A5. the real NBA round is readable via the normal customer round-detail endpoint");
    assert(roundDetailRes.body.data.games.length === 8, "A5. round has exactly 8 games");
    assert(roundDetailRes.body.data.selectionLabel === "20+ Points", "A5. selection label reflects the real NBA rule");
    assert(roundDetailRes.body.data.competition.prizePoolVisible === false, "A5. pool hidden — these real games are genuinely in the future");
    assert(roundDetailRes.body.data.games.every((g: { eligiblePlayers: unknown[] }) => g.eligiblePlayers.length > 0), "A5. every game has real eligible players (full roster) available for selection");

    const entrySelections = roundDetailRes.body.data.games.map((g: { id: number; eligiblePlayers: { id: number }[] }) => ({
      gameId: g.id,
      player1Id: g.eligiblePlayers[0].id,
      player2Id: g.eligiblePlayers[1].id,
    }));
    const createEntryRes = await api(`/api/nba/rounds/${nbaRoundId}/entries`, {
      method: "POST",
      headers: { Authorization: `Bearer ${userAToken}` },
      body: JSON.stringify({ selections: entrySelections }),
    });
    assert(createEntryRes.status === 201, `A6. real 16-selection NBA entry created (${JSON.stringify(createEntryRes.body)})`);
    const entryId = createEntryRes.body.data.entryId as number;

    // Directly finalize the real games with real-shaped stats (the actual games haven't
    // been played yet — this is the standard QA convention of seeding a settlement
    // outcome directly, same as every other phase's QA script does).
    nbaCompetitionId = (await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, nbaRoundId!)))[0].id;
    await withDbRetry(() => db.update(schema.games).set({ status: "final", homeScore: 100, awayScore: 90 }).where(inArray(schema.games.id, nbaGameIds)));
    for (const sel of entrySelections) {
      const stat1 = { gameId: sel.gameId, playerId: sel.player1Id, teamId: 0, points: 20 }; // exactly 20 = HIT
      const stat2 = { gameId: sel.gameId, playerId: sel.player2Id, teamId: 0, points: 19 }; // 19 = MISS
      const [g] = await withDbRetry(() => db.select().from(schema.games).where(eq(schema.games.id, sel.gameId)));
      stat1.teamId = g.homeTeamId;
      stat2.teamId = g.awayTeamId;
      await withDbRetry(() => db.insert(schema.playerGameStats).values(stat1).onConflictDoUpdate({ target: [schema.playerGameStats.gameId, schema.playerGameStats.playerId], set: { points: 20 } }));
      await withDbRetry(() => db.insert(schema.playerGameStats).values(stat2).onConflictDoUpdate({ target: [schema.playerGameStats.gameId, schema.playerGameStats.playerId], set: { points: 19 } }));
      nbaStatRowGameIds.push(sel.gameId);
    }

    await db.update(schema.competitions).set({ status: "closed" }).where(eq(schema.competitions.id, nbaCompetitionId));
    const settleRes = await api(`/api/admin/competitions/${nbaCompetitionId}/settle`, { method: "POST", headers: adminHeaders });
    assert(settleRes.status === 200, `A7. NBA competition settles using the exact same settlement engine as NRL/AFL (${JSON.stringify(settleRes.body)})`);

    const entryDetailRes = await api(`/api/entries/${entryId}`, { headers: { Authorization: `Bearer ${userAToken}` } });
    assert(entryDetailRes.body.data.entry.entryResult === "not_perfect", "A8. entry is NOT_PERFECT — every player2 scored exactly 19 (MISS)");
    assert(entryDetailRes.body.data.entry.selections.every((s: { player1Result: string }) => s.player1Result === "correct"), "A8. every 20-point player1 settles as correct (>=20 threshold)");
    assert(entryDetailRes.body.data.entry.selections.every((s: { player2Result: string }) => s.player2Result === "incorrect"), "A8. every 19-point player2 settles as incorrect (below the 20 threshold)");

    // Void resolution: one of the games is later ruled postponed/cancelled — its
    // selections must never be silently guessed, and must never block a PERFECT outcome
    // if every other real selection is correct.
    const voidGameId = nbaGameIds[0];
    const voidRes = await api("/api/admin/nba/void-game", { method: "POST", headers: adminHeaders, body: JSON.stringify({ gameId: voidGameId, reason: `${MARK} qa cancellation` }) });
    assert(voidRes.status === 200, "A9. voiding a game succeeds");
    const [votedGameRow] = await db.select().from(schema.games).where(eq(schema.games.id, voidGameId));
    assert(votedGameRow.status === "cancelled", "A9. the voided game is marked cancelled, not silently left as final/scheduled");
    const voidedSelections = await db.select().from(schema.entrySelections).where(eq(schema.entrySelections.gameId, voidGameId));
    // These selections were already settled (correct/incorrect) above, so voidGame must
    // NOT retroactively overwrite them — immutability applies to void too.
    assert(voidedSelections.every((s) => s.player1Result === "correct" && s.player2Result === "incorrect"), "A9. voiding a game never overwrites already-settled selections — immutability preserved");

    // ============================================================
    // PART B — NRL: the SAME curation engine supports a reduced (Origin-week-style) round
    // ============================================================
    const mockProvider = createLifecycleMockProvider({ referenceTime: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365) }); // 1yr out, no collision with real data or Part A
    // sports.code is globally unique — reuse the "nrl" sport row if one already exists
    // (it does, in any real Perfect 2 dev DB), otherwise create it.
    const existingNrl = (await db.select().from(schema.sports).where(eq(schema.sports.code, "nrl")))[0];
    nrlSportId = existingNrl ? existingNrl.id : (await db.insert(schema.sports).values({ code: "nrl", name: "NRL" }).returning())[0].id;

    await syncSeasons(mockProvider, "nrl");
    await syncTeams(mockProvider, "nrl");
    const nrlSeasonRow = (await db.select().from(schema.seasons).where(eq(schema.seasons.externalId, "mock-lc-season-nrl")))[0];
    nrlSeasonId = nrlSeasonRow.id;

    const poolRoundResult = await getOrCreateSchedulePoolRound(nrlSeasonId);
    if (poolRoundResult.status !== "ok") throw new Error(poolRoundResult.message);
    const gamesSyncSummary = await syncProviderGamesIntoPool(mockProvider, poolRoundResult.data.id, "mock-lc-round-nrl-1");
    assert(gamesSyncSummary.errors.length === 0, "B1. syncing a provider's native round into the schedule pool succeeds (mock fixture — Champion Data not connected, exactly as documented)");

    const allNrlGames = await db.select().from(schema.games).where(eq(schema.games.roundId, poolRoundResult.data.id));
    const mockNrlGames = allNrlGames.filter((g) => g.externalId?.startsWith("mock-lc-nrl-game-"));
    assert(mockNrlGames.length === 4, "B1. all 4 real (mock-labelled) NRL fixture games landed in the schedule pool, uncurated");

    // Curate only the STILL-SCHEDULED games into an "Origin week"-style reduced round.
    // The lifecycle fixture deliberately mixes statuses (final/live/scheduled/scheduled —
    // see mock-provider.ts) so isSelectionLocked (src/lib/selections/validate.ts) locks a
    // game the instant its status isn't "scheduled", regardless of how far in the future
    // its kickoff is shifted — an entry can only ever be created against games that are
    // genuinely still open, so the reduced round is curated from exactly those, not an
    // arbitrary slice of the fixture.
    const openNrlGames = mockNrlGames.filter((g) => g.status === "scheduled");
    const originAssignments = openNrlGames.map((g) => ({ gameId: g.id, slotLabel: null }));
    const originShapeCheck = validateRoundShape("nrl", originAssignments);
    assert(originShapeCheck.valid, `B2. a ${originAssignments.length}-game NRL round shape validates successfully — no fixed universal game count`);

    const nrlRoundResult = await createRound({ sportId: nrlSportId, seasonId: nrlSeasonId, roundNumber: 9999, name: `${MARK}-nrl-origin-week`, startDate: "2027-06-01", endDate: "2027-06-03" });
    if (nrlRoundResult.status !== "ok") throw new Error(nrlRoundResult.message);
    nrlRoundId = nrlRoundResult.data.id;

    const assignResult = await assignCandidatesToRound("nrl", nrlRoundId, originAssignments);
    assert(assignResult.status === "ok" && assignResult.assigned === originAssignments.length, `B2. exactly ${originAssignments.length} real games curated into the reduced round`);

    const eligibilitySummary = await syncPlayerEligibilityForGames(mockProvider, "nrl", originAssignments.map((a) => a.gameId));
    assert(eligibilitySummary.errors.length === 0, `B2b. player eligibility synced for the ${originAssignments.length} curated games with no errors (${JSON.stringify(eligibilitySummary.errors)})`);

    // Drive an entry through the REAL customer API for this reduced round — proving the
    // entry/progress/HIT-MISS engine truly adapts, never assuming a fixed 8 games/16 picks.
    const nrlRoundDetailRes = await api(`/api/nrl/rounds/${nrlRoundId}`);
    assert(nrlRoundDetailRes.status === 200, "B3. the reduced NRL round is readable via the normal round-detail endpoint");
    assert(nrlRoundDetailRes.body.data.games.length === originAssignments.length, `B3. exactly ${originAssignments.length} games, not a hard-coded 8`);

    const nrlSelections = nrlRoundDetailRes.body.data.games.map((g: { id: number; eligiblePlayers: { id: number }[] }) => ({
      gameId: g.id,
      player1Id: g.eligiblePlayers[0].id,
      player2Id: g.eligiblePlayers[1].id,
    }));
    const nrlEntryRes = await api(`/api/nrl/rounds/${nrlRoundId}/entries`, { method: "POST", headers: { Authorization: `Bearer ${userAToken}` }, body: JSON.stringify({ selections: nrlSelections }) });
    assert(nrlEntryRes.status === 201, `B4. a ${nrlSelections.length * 2}-selection (${nrlSelections.length}-game) NRL entry is created successfully (${JSON.stringify(nrlEntryRes.body)})`);
    assert(nrlEntryRes.body.data.entryId > 0, "B4. real entry id returned");

    // The HTTP admin route for NRL/AFL provider-round sync depends on the server
    // process's own SPORTS_DATA_PROVIDER env var — smoke-test its documented fail-safe
    // behavior (unconfigured by default) rather than assume this script can flip the
    // running server's environment.
    const providerRouteRes = await api("/api/admin/rounds/sync-provider-round", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ sportCode: "nrl", sportName: "NRL", seasonExternalId: "does-not-matter", roundExternalId: "does-not-matter" }),
    });
    assert(providerRouteRes.status === 503, "B5. the NRL provider-round sync route fails safe (503) while no real provider is configured — never fabricates a connection");
  } finally {
    console.log("Cleaning up QA data...");

    // --- NBA: delete only what THIS run created (round/competition/entries/selections/
    // stats/void state) — the real teams/players/season/schedule-pool games stay, exactly
    // as real reference data would after a genuine admin sync. ---
    if (nbaCompetitionId) {
      const entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, nbaCompetitionId));
      for (const e of entries) await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, e.id));
      await db.delete(schema.paymentTransactions).where(eq(schema.paymentTransactions.competitionId, nbaCompetitionId));
      await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, nbaCompetitionId));
      await db.delete(schema.competitions).where(eq(schema.competitions.id, nbaCompetitionId));
    }
    if (nbaStatRowGameIds.length) await db.delete(schema.playerGameStats).where(inArray(schema.playerGameStats.gameId, nbaStatRowGameIds));
    if (nbaRoundId) await db.delete(schema.rounds).where(eq(schema.rounds.id, nbaRoundId));
    // Reset the real games we borrowed back to "scheduled" / unassigned, back in the pool,
    // so they remain usable real candidates for a future real admin curation.
    if (nbaGameIds.length) {
      await db.update(schema.games).set({ status: "scheduled", homeScore: null, awayScore: null, slotLabel: null }).where(inArray(schema.games.id, nbaGameIds));
    }

    // --- NRL: delete the QA-created reduced round + its entries/selections. The mock
    // fixture's teams/players/games (mock-lc-*) are left for other QA runs to reuse,
    // matching how the Phase 21 lifecycle mock provider's own QA script already treats
    // them (idempotent upserts, not per-run fixtures). ---
    if (nrlRoundId) {
      const nrlComp = (await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, nrlRoundId)))[0];
      if (nrlComp) {
        const entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, nrlComp.id));
        for (const e of entries) await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, e.id));
        await db.delete(schema.paymentTransactions).where(eq(schema.paymentTransactions.competitionId, nrlComp.id));
        await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, nrlComp.id));
        await db.delete(schema.competitions).where(eq(schema.competitions.id, nrlComp.id));
      }
      await db.delete(schema.rounds).where(eq(schema.rounds.id, nrlRoundId));
    }
    void nrlTeamIds;
    void nrlPlayerIds;

    const userRows = await db.select().from(schema.users).where(inArray(schema.users.email, userEmails));
    const userIds = userRows.map((u) => u.id);
    if (userIds.length) {
      await db.delete(schema.paymentTransactions).where(inArray(schema.paymentTransactions.userId, userIds));
      await db.delete(schema.sessions).where(inArray(schema.sessions.userId, userIds));
      await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    }

    console.log(`=== PHASE 22 QA CHECKS: ${passCount} passed ===`);

    // Independent verification — the QA-specific rows are gone (real reference data is
    // deliberately NOT checked here — see the cleanup note above).
    const remainingUsers = await db.select().from(schema.users).where(inArray(schema.users.email, userEmails));
    const remainingNbaRound = nbaRoundId ? await db.select().from(schema.rounds).where(eq(schema.rounds.id, nbaRoundId)) : [];
    const remainingNrlRound = nrlRoundId ? await db.select().from(schema.rounds).where(eq(schema.rounds.id, nrlRoundId)) : [];
    if (remainingUsers.length || remainingNbaRound.length || remainingNrlRound.length) {
      throw new Error(`Cleanup verification FAILED: ${remainingUsers.length} users, ${remainingNbaRound.length} nba rounds, ${remainingNrlRound.length} nrl rounds still present.`);
    }
    console.log("Cleanup complete and verified for all QA-created rows.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
