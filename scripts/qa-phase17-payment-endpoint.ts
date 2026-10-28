/**
 * PHASE 17 QA — verifies the new POST /api/[sport]/rounds/[roundId]/payment pre-flight
 * endpoint against the real running backend. Seeds temporary, clearly-marked data,
 * exercises the real endpoint, then deletes everything it created — same convention as
 * scripts/qa-seed.ts / qa-cleanup.ts / qa-phase16-payment-flow.ts.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../src/db/schema";

const API_URL = "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

const MARK = "qa-test-internal-phase17";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function registerUser(email: string) {
  const result = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password: "qa-test-password-123", name: "QA Phase17" }),
  });
  if (!result.body.ok) throw new Error(`register failed for ${email}: ${JSON.stringify(result.body)}`);
  return result.body.data.token as string;
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`PASS: ${msg}`);
}

async function main() {
  console.log("=== PHASE 17 QA: payment pre-flight endpoint ===");

  // --- seed: NRL round with a non-default entryFeeCents (750, not 500) to prove the
  // price is genuinely read from the DB, not hardcoded --- plus a second sport (AFL) and
  // round for the cross-sport check.
  // Reuse the real dev DB's existing "nrl"/"afl" sport rows if they exist (they do, in any
  // real Perfect 2 dev DB with later phases' data already seeded) — sports.code is
  // globally unique.
  const existingNrlSport = (await db.select().from(schema.sports).where(eq(schema.sports.code, "nrl")))[0];
  const nrlSportWasCreatedByThisRun = !existingNrlSport;
  const nrlSport = existingNrlSport ?? (await db.insert(schema.sports).values({ code: "nrl", name: "QA NRL" }).returning())[0];
  const existingAflSport = (await db.select().from(schema.sports).where(eq(schema.sports.code, "afl")))[0];
  const aflSportWasCreatedByThisRun = !existingAflSport;
  const aflSport = existingAflSport ?? (await db.insert(schema.sports).values({ code: "afl", name: "QA AFL" }).returning())[0];

  // Defensive pre-flight: remove any orphaned QA seasons left by a previous crashed run at
  // the same fixed (sportId, year=2099) pairs, now that the sport rows are reused.
  for (const [sport, label] of [
    [nrlSport, `${MARK}-nrl-season`],
    [aflSport, `${MARK}-afl-season`],
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

  const [nrlSeason] = await db.insert(schema.seasons).values({ sportId: nrlSport.id, year: 2099, label: `${MARK}-nrl-season` }).returning();
  const [aflSeason] = await db.insert(schema.seasons).values({ sportId: aflSport.id, year: 2099, label: `${MARK}-afl-season` }).returning();
  const [nrlRound] = await db.insert(schema.rounds).values({ seasonId: nrlSeason.id, roundNumber: 1, name: `${MARK}-nrl-round` }).returning();
  const [aflRound] = await db.insert(schema.rounds).values({ seasonId: aflSeason.id, roundNumber: 1, name: `${MARK}-afl-round` }).returning();
  const [nrlCompetition] = await db
    .insert(schema.competitions)
    .values({ sportId: nrlSport.id, roundId: nrlRound.id, name: `${MARK}-nrl-competition`, entryFeeCents: 750, status: "open" })
    .returning();

  console.log(`Seeded: nrlRound=${nrlRound.id} aflRound=${aflRound.id} nrlCompetition=${nrlCompetition.id} (entryFeeCents=${nrlCompetition.entryFeeCents})`);

  let cleanupUserIds: number[] = [];
  try {
    const emailA = `${MARK}-a@perfect2.test`;
    const tokenA = await registerUser(emailA);
    const emailB = `${MARK}-b@perfect2.test`;
    const tokenB = await registerUser(emailB);

    // 1. Unauthenticated -> 401
    const unauth = await api(`/api/nrl/rounds/${nrlRound.id}/payment`, { method: "POST" });
    assert(unauth.status === 401, "unauthenticated request rejected with 401");

    // 2. Unknown round -> 404
    const notFound = await api(`/api/nrl/rounds/999999999/payment`, { method: "POST", headers: { Authorization: `Bearer ${tokenA}` } });
    assert(notFound.status === 404, "unknown round rejected with 404");

    // 3. Price comes from entryFeeCents (750, not the 500 default) — and client-supplied
    //    body values are completely ignored (server never reads the request body here).
    const priceCheck = await api(`/api/nrl/rounds/${nrlRound.id}/payment`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ amountCents: 1, competitionId: 999999, currency: "USD" }),
    });
    assert(priceCheck.status === 200 && priceCheck.body.ok, "open competition accepts a payment attempt");
    assert(priceCheck.body.data.amountCents === 750, `price is server-derived from entryFeeCents (got ${priceCheck.body.data.amountCents}, expected 750, client tried to send 1)`);
    assert(priceCheck.body.data.currency === "AUD", "currency is server-fixed to AUD regardless of client input");
    assert(priceCheck.body.data.status === "pending", "dev payment provider returns pending, never paid");

    // 4. Cross-sport contamination guard: calling AFL's payment route with the NRL round id
    const crossSport = await api(`/api/afl/rounds/${nrlRound.id}/payment`, { method: "POST", headers: { Authorization: `Bearer ${tokenA}` } });
    assert(crossSport.status === 422, "cross-sport mismatch (AFL route + NRL round) rejected with 422");

    // 5. A separate, real AFL round/sport is unaffected — proves NRL and AFL stay separate
    const aflOwnRound = await api(`/api/afl/rounds/${aflRound.id}/payment`, { method: "POST", headers: { Authorization: `Bearer ${tokenA}` } });
    assert(aflOwnRound.status === 200 && aflOwnRound.body.data.amountCents === 500, "AFL's own round prices independently (default 500) from NRL's 750");

    // 6. Create a real entry for user A so we can test duplicate + closed + settled against it
    const [homeTeam] = await db.insert(schema.teams).values({ sportId: nrlSport.id, name: `${MARK}-home`, shortName: "QAH", slug: `${MARK}-home` }).returning();
    const [awayTeam] = await db.insert(schema.teams).values({ sportId: nrlSport.id, name: `${MARK}-away`, shortName: "QAA", slug: `${MARK}-away` }).returning();
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const [game] = await db.insert(schema.games).values({ roundId: nrlRound.id, homeTeamId: homeTeam.id, awayTeamId: awayTeam.id, kickoff: future, status: "scheduled" }).returning();
    const [p1] = await db.insert(schema.players).values({ sportId: nrlSport.id, teamId: homeTeam.id, firstName: "QA", lastName: "One" }).returning();
    const [p2] = await db.insert(schema.players).values({ sportId: nrlSport.id, teamId: awayTeam.id, firstName: "QA", lastName: "Two" }).returning();
    await db.insert(schema.gameLineups).values([
      { gameId: game.id, teamId: homeTeam.id, playerId: p1.id, position: "Fullback" },
      { gameId: game.id, teamId: awayTeam.id, playerId: p2.id, position: "Fullback" },
    ]);
    const entryResult = await api(`/api/nrl/rounds/${nrlRound.id}/entries`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ selections: [{ gameId: game.id, player1Id: p1.id, player2Id: p2.id }] }),
    });
    assert(entryResult.status === 201, "real entry created for user A to test duplicate/closed/settled against");

    // 7. Duplicate: user A attempting payment again for the same competition -> 409
    const dup = await api(`/api/nrl/rounds/${nrlRound.id}/payment`, { method: "POST", headers: { Authorization: `Bearer ${tokenA}` } });
    assert(dup.status === 409, "user A's second payment attempt for the same competition rejected with 409 (already entered)");

    // 8. User B (different user, same competition) is NOT blocked by user A's entry
    const userBAttempt = await api(`/api/nrl/rounds/${nrlRound.id}/payment`, { method: "POST", headers: { Authorization: `Bearer ${tokenB}` } });
    assert(userBAttempt.status === 200, "user B's payment attempt is independent of user A's entry (no cross-user contamination)");

    // 9. Closed competition -> 422, blocks both new users
    await db.update(schema.competitions).set({ status: "closed" }).where(eq(schema.competitions.id, nrlCompetition.id));
    const closed = await api(`/api/nrl/rounds/${nrlRound.id}/payment`, { method: "POST", headers: { Authorization: `Bearer ${tokenB}` } });
    assert(closed.status === 422, "closed competition rejects a new payment attempt with 422");

    // 10. Settled competition -> 422
    await db.update(schema.competitions).set({ status: "settled" }).where(eq(schema.competitions.id, nrlCompetition.id));
    const settled = await api(`/api/nrl/rounds/${nrlRound.id}/payment`, { method: "POST", headers: { Authorization: `Bearer ${tokenB}` } });
    assert(settled.status === 422, "settled competition rejects a payment attempt with 422");

    const userA = await db.select().from(schema.users).where(eq(schema.users.email, emailA));
    const userB = await db.select().from(schema.users).where(eq(schema.users.email, emailB));
    cleanupUserIds = [...userA.map((u) => u.id), ...userB.map((u) => u.id)];

    console.log("=== ALL PHASE 17 PAYMENT-ENDPOINT CHECKS PASSED ===");
  } finally {
    console.log("Cleaning up QA data...");
    const allCompetitions = await db
      .select()
      .from(schema.competitions)
      .where(eq(schema.competitions.name, `${MARK}-nrl-competition`));
    const aflCompetitions = await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, aflRound.id));
    const competitionIds = [...allCompetitions.map((c) => c.id), ...aflCompetitions.map((c) => c.id)];
    for (const cid of competitionIds) {
      const entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, cid));
      for (const e of entries) await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, e.id));
      await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, cid));
      await db.delete(schema.competitions).where(eq(schema.competitions.id, cid));
    }
    const games = await db.select().from(schema.games).where(eq(schema.games.roundId, nrlRound.id));
    for (const g of games) {
      await db.delete(schema.gameLineups).where(eq(schema.gameLineups.gameId, g.id));
      await db.delete(schema.games).where(eq(schema.games.id, g.id));
    }
    // Delete only the specific players/teams THIS run created — looked up by their known
    // QA slug/name rather than by sportId, since sport rows are now reused, shared
    // reference data and filtering by sportId alone would delete every other
    // real/other-QA team and player under that sport too.
    const qaTeams = await db.select().from(schema.teams).where(and(eq(schema.teams.sportId, nrlSport.id), inArray(schema.teams.slug, [`${MARK}-home`, `${MARK}-away`])));
    const qaTeamIds = qaTeams.map((t) => t.id);
    if (qaTeamIds.length) {
      await db.delete(schema.players).where(inArray(schema.players.teamId, qaTeamIds));
      await db.delete(schema.teams).where(inArray(schema.teams.id, qaTeamIds));
    }
    await db.delete(schema.rounds).where(eq(schema.rounds.id, nrlRound.id));
    await db.delete(schema.rounds).where(eq(schema.rounds.id, aflRound.id));
    await db.delete(schema.seasons).where(eq(schema.seasons.id, nrlSeason.id));
    await db.delete(schema.seasons).where(eq(schema.seasons.id, aflSeason.id));
    if (nrlSportWasCreatedByThisRun) await db.delete(schema.sports).where(eq(schema.sports.id, nrlSport.id));
    if (aflSportWasCreatedByThisRun) await db.delete(schema.sports).where(eq(schema.sports.id, aflSport.id));
    for (const uid of cleanupUserIds) {
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, uid));
      await db.delete(schema.users).where(eq(schema.users.id, uid));
    }
    console.log("Cleanup complete.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
