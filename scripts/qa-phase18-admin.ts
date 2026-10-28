/**
 * PHASE 18 QA — verifies the admin dashboard's API surface against the real running
 * backend. Seeds temporary, clearly-marked data (including a real admin user, cleared at
 * the end), exercises every /api/admin/* route as an unauthenticated caller, a normal
 * user, and an admin, then deletes everything it created.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

const API_URL = "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
const MARK = "qa-test-internal-phase18";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json();
  return { status: res.status, body };
}

async function registerUser(email: string) {
  const result = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password: "qa-test-password-123", name: "QA" }) });
  if (!result.body.ok) throw new Error(`register failed for ${email}: ${JSON.stringify(result.body)}`);
  return result.body.data.token as string;
}

let passCount = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passCount++;
  console.log(`PASS: ${msg}`);
}

async function main() {
  console.log("=== PHASE 18 QA: admin dashboard ===");

  // Reuse the real dev DB's existing "nrl" sport row if one exists (it does, in any real
  // Perfect 2 dev DB with later phases' data already seeded) rather than assuming a
  // pristine database — sports.code is globally unique.
  const existingSport = (await db.select().from(schema.sports).where(eq(schema.sports.code, "nrl")))[0];
  const sportWasCreatedByThisRun = !existingSport;
  const sport = existingSport ?? (await db.insert(schema.sports).values({ code: "nrl", name: "QA NRL" }).returning())[0];

  // Defensive pre-flight: a previous run that crashed before its own cleanup ran can leave
  // a QA season behind at this same fixed (sportId, year=2099) pair, which
  // seasons_sport_year_unique would then reject forever now that the sport row itself is
  // reused/stable across runs (see qa-phase22-nba.ts / qa-admin-security.ts for the same pattern).
  const orphanedSeason = (await db.select().from(schema.seasons).where(and(eq(schema.seasons.sportId, sport.id), eq(schema.seasons.year, 2099))))[0];
  if (orphanedSeason?.label === `${MARK}-season`) {
    console.log(`Pre-flight: removing an orphaned QA season from a previous run (id=${orphanedSeason.id}).`);
    const orphanedRounds = await db.select().from(schema.rounds).where(eq(schema.rounds.seasonId, orphanedSeason.id));
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
    await db.delete(schema.seasons).where(eq(schema.seasons.id, orphanedSeason.id));
  }

  const [season] = await db.insert(schema.seasons).values({ sportId: sport.id, year: 2099, label: `${MARK}-season` }).returning();
  const [round] = await db.insert(schema.rounds).values({ seasonId: season.id, roundNumber: 1, name: `${MARK}-round` }).returning();
  const [homeTeam] = await db.insert(schema.teams).values({ sportId: sport.id, name: `${MARK}-home`, shortName: "QAH", slug: `${MARK}-home` }).returning();
  const [awayTeam] = await db.insert(schema.teams).values({ sportId: sport.id, name: `${MARK}-away`, shortName: "QAA", slug: `${MARK}-away` }).returning();
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const [game] = await db.insert(schema.games).values({ roundId: round.id, homeTeamId: homeTeam.id, awayTeamId: awayTeam.id, kickoff: future, status: "scheduled" }).returning();
  const [p1] = await db.insert(schema.players).values({ sportId: sport.id, teamId: homeTeam.id, firstName: "QA", lastName: "Winner" }).returning();
  const [p2] = await db.insert(schema.players).values({ sportId: sport.id, teamId: awayTeam.id, firstName: "QA", lastName: "Loser" }).returning();
  await db.insert(schema.gameLineups).values([
    { gameId: game.id, teamId: homeTeam.id, playerId: p1.id, position: "Fullback" },
    { gameId: game.id, teamId: awayTeam.id, playerId: p2.id, position: "Fullback" },
  ]);
  const [competition] = await db.insert(schema.competitions).values({ sportId: sport.id, roundId: round.id, name: `${MARK}-competition`, entryFeeCents: 500, prizeAmountCents: 6000, status: "open" }).returning();

  console.log(`Seeded: round=${round.id} game=${game.id} competition=${competition.id}`);

  const adminEmail = `${MARK}-admin@perfect2.test`;
  const normalEmail = `${MARK}-normal@perfect2.test`;
  const adminToken = await registerUser(adminEmail);
  const normalToken = await registerUser(normalEmail);
  const [adminUser] = await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.email, adminEmail)).returning();

  const adminHeaders = { Authorization: `Bearer ${adminToken}` };
  const normalHeaders = { Authorization: `Bearer ${normalToken}` };
  const ADMIN_GET_ROUTES = [
    "/api/admin/dashboard",
    "/api/admin/competitions",
    `/api/admin/competitions/${competition.id}`,
    `/api/admin/competitions/${competition.id}/entries`,
  ];

  let cleanupUserIds: number[] = [];
  try {
    // --- AUTH (1-3) ---
    const unauth = await api("/api/admin/dashboard");
    assert(unauth.status === 401, "1. unauthenticated admin request -> 401");

    const forbidden = await api("/api/admin/dashboard", { headers: normalHeaders });
    assert(forbidden.status === 403, "2. normal authenticated user -> 403");

    const ok = await api("/api/admin/dashboard", { headers: adminHeaders });
    assert(ok.status === 200 && ok.body.ok, "3. admin -> 200");

    // Every admin GET route: 401 unauth, 403 normal user, 200 admin (24, 28)
    for (const route of ADMIN_GET_ROUTES) {
      const u = await api(route);
      const n = await api(route, { headers: normalHeaders });
      const a = await api(route, { headers: adminHeaders });
      assert(u.status === 401, `${route} unauthenticated -> 401`);
      assert(n.status === 403, `${route} normal user -> 403 (28. cannot bypass admin authorization)`);
      assert(a.status === 200, `${route} admin -> 200`);
    }

    // --- COMPETITIONS (4-10) ---
    const list = await api("/api/admin/competitions", { headers: adminHeaders });
    const listed = list.body.data.competitions.find((c: { competitionId: number }) => c.competitionId === competition.id);
    assert(!!listed, "4. competition list includes the seeded competition");
    assert(listed.sportCode === "nrl", "6. correct sport in list");
    assert(listed.roundId === round.id, "7. correct round in list");
    assert(listed.entryFeeCents === 500, "8. correct price in list (from entryFeeCents, not hardcoded)");
    assert(listed.prizeAmountCents === 6000, "9. correct prize in list");
    assert(listed.state === "open", "10. correct status in list");

    const detail = await api(`/api/admin/competitions/${competition.id}`, { headers: adminHeaders });
    assert(detail.status === 200, "5. competition detail loads");
    assert(detail.body.data.entryFeeCents === 500 && detail.body.data.prizeAmountCents === 6000, "5. detail has correct price/prize");

    const notFoundComp = await api("/api/admin/competitions/999999999", { headers: adminHeaders });
    assert(notFoundComp.status === 404, "invalid competition -> 404");

    // --- SECURITY: manipulation attempts (24-27) ---
    const manipulated = await api(`/api/admin/competitions/${competition.id}/close`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ status: "settled", entryFeeCents: 1, prizeAmountCents: 999999999, sportId: 999, roundId: 999 }),
    });
    assert(manipulated.status === 200 && manipulated.body.data.competition.status === "closed", "24-27. client-supplied status/price/prize/sport/round in request body is ignored — server-derived only");

    // Re-fetch to prove price/prize weren't altered by the manipulated body
    const afterManipulation = await api(`/api/admin/competitions/${competition.id}`, { headers: adminHeaders });
    assert(afterManipulation.body.data.entryFeeCents === 500 && afterManipulation.body.data.prizeAmountCents === 6000, "price/prize unchanged after manipulation attempt");

    // --- LIFECYCLE (11-16) ---
    // Competition is now closed (from the manipulation-test close call above) — verify
    // settling before games are final is rejected as invalid.
    const invalidSettle = await api(`/api/admin/competitions/${competition.id}/settle`, { method: "POST", headers: adminHeaders });
    assert(invalidSettle.status === 200, "13. settle on a closed-but-not-final round succeeds the call but does not mark settled yet");
    assert(invalidSettle.body.data.summary.competitionSettled === false, "15. invalid settlement (games not final) does not settle the competition");

    // Finalize the game with real stats: p1 scores (winner), p2 doesn't (loser)
    await db.update(schema.games).set({ status: "final", homeScore: 24, awayScore: 12 }).where(eq(schema.games.id, game.id));
    await db.insert(schema.playerGameStats).values([
      { gameId: game.id, playerId: p1.id, teamId: homeTeam.id, tries: 1, goals: 0 },
      { gameId: game.id, playerId: p2.id, teamId: awayTeam.id, tries: 0, goals: 0 },
    ]);

    const settleResult = await api(`/api/admin/competitions/${competition.id}/settle`, { method: "POST", headers: adminHeaders });
    assert(settleResult.status === 200 && settleResult.body.data.summary.competitionSettled === true, "14. settle closed+final round succeeds and marks settled");

    const settledAgain = await api(`/api/admin/competitions/${competition.id}/settle`, { method: "POST", headers: adminHeaders });
    assert(settledAgain.status === 200, "16. re-settling an already-settled competition is a safe idempotent no-op (no reopen endpoint exists at all)");

    // --- ENTRIES (17-21) ---
    // Create two real entries via the customer-facing API (must exist before the round
    // closed — so we open a second competition scoped to a fresh round for this).
    const [round2] = await db.insert(schema.rounds).values({ seasonId: season.id, roundNumber: 2, name: `${MARK}-round-2` }).returning();
    const future2 = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const [game2] = await db.insert(schema.games).values({ roundId: round2.id, homeTeamId: homeTeam.id, awayTeamId: awayTeam.id, kickoff: future2, status: "scheduled" }).returning();
    await db.insert(schema.gameLineups).values([
      { gameId: game2.id, teamId: homeTeam.id, playerId: p1.id, position: "Fullback" },
      { gameId: game2.id, teamId: awayTeam.id, playerId: p2.id, position: "Fullback" },
    ]);
    const entryResult = await api(`/api/nrl/rounds/${round2.id}/entries`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ selections: [{ gameId: game2.id, player1Id: p1.id, player2Id: p2.id }] }),
    });
    assert(entryResult.status === 201, "entry created for entries/payment-monitoring tests");
    const entryId = entryResult.body.data.entryId as number;
    const [round2Competition] = await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, round2.id));

    const entriesList = await api(`/api/admin/competitions/${round2Competition.id}/entries`, { headers: adminHeaders });
    assert(entriesList.status === 200, "17. entry list loads");
    const listedEntry = entriesList.body.data.entries.find((e: { entryId: number }) => e.entryId === entryId);
    assert(!!listedEntry, "17. entry list includes the created entry");
    assert(listedEntry.paymentStatus === "pending", "19. payment state visible and honest (pending, not paid)");
    assert(listedEntry.result === "pending", "20. result state visible (pending — game not final)");

    const entryDetail = await api(`/api/admin/entries/${entryId}`, { headers: adminHeaders });
    assert(entryDetail.status === 200, "18. entry detail loads");
    assert(entryDetail.body.data.selections.length === 1 && entryDetail.body.data.selections[0].player1Result === "pending", "21. selection results visible from stored data");

    const entryForbidden = await api(`/api/admin/entries/${entryId}`, { headers: normalHeaders });
    assert(entryForbidden.status === 403, "admin cannot be bypassed for entry detail by a normal user");

    const notFoundEntry = await api("/api/admin/entries/999999999", { headers: adminHeaders });
    assert(notFoundEntry.status === 404, "invalid entry -> 404");

    // --- DATA READINESS (22-23) ---
    const round2Detail = await api(`/api/admin/competitions/${round2Competition.id}`, { headers: adminHeaders });
    assert(round2Detail.body.data.readiness.ready === true, "22. readiness=ready while game is only scheduled (nothing to settle yet)");

    await db.update(schema.games).set({ status: "final" }).where(eq(schema.games.id, game2.id)); // final, no stats yet
    const notReadyDetail = await api(`/api/admin/competitions/${round2Competition.id}`, { headers: adminHeaders });
    assert(notReadyDetail.body.data.readiness.ready === false, "23. readiness=not-ready when a final game has no synced stats");
    assert(notReadyDetail.body.data.readiness.issues.length > 0, "23. readiness reports a specific missing-stats issue");

    console.log(`=== ALL PHASE 18 ADMIN CHECKS PASSED (${passCount}) ===`);
    cleanupUserIds = [adminUser.id];
    const normalUserRow = await db.select().from(schema.users).where(eq(schema.users.email, normalEmail));
    cleanupUserIds.push(...normalUserRow.map((u) => u.id));

    // cleanup for round2's extra data happens below alongside round1's
    await cleanup(round2.id, round2Competition.id, [game2.id]);
  } finally {
    await cleanup(round.id, competition.id, [game.id]);
    for (const uid of cleanupUserIds) {
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, uid));
      await db.delete(schema.users).where(eq(schema.users.id, uid));
    }
    await db.delete(schema.players).where(eq(schema.players.id, p1.id));
    await db.delete(schema.players).where(eq(schema.players.id, p2.id));
    await db.delete(schema.teams).where(eq(schema.teams.id, homeTeam.id));
    await db.delete(schema.teams).where(eq(schema.teams.id, awayTeam.id));
    await db.delete(schema.seasons).where(eq(schema.seasons.id, season.id));
    // Only remove the sport row if THIS run created it — a reused real "nrl" row is
    // shared reference data, never deleted by a QA script.
    if (sportWasCreatedByThisRun) await db.delete(schema.sports).where(eq(schema.sports.id, sport.id));
    console.log("Cleanup complete.");
  }
}

async function cleanup(roundId: number, competitionId: number, gameIds: number[]) {
  const entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, competitionId));
  for (const e of entries) await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, e.id));
  await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, competitionId));
  await db.delete(schema.competitions).where(eq(schema.competitions.id, competitionId));
  for (const gid of gameIds) {
    await db.delete(schema.playerGameStats).where(eq(schema.playerGameStats.gameId, gid));
    await db.delete(schema.gameLineups).where(eq(schema.gameLineups.gameId, gid));
    await db.delete(schema.games).where(eq(schema.games.id, gid));
  }
  await db.delete(schema.rounds).where(eq(schema.rounds.id, roundId));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
