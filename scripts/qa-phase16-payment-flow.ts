/**
 * PHASE 16 QA — verifies the payment-wired createEntry path against the real running
 * backend (http://localhost:3000). Seeds temporary, clearly-marked data, exercises the
 * real POST entries endpoint through two real registered users, then deletes everything
 * it created — same lifecycle convention as scripts/qa-seed.ts / qa-cleanup.ts (Phase 13).
 *
 * Checks:
 *  1. A successful entry is created with paymentStatus "pending" (never "paid") and
 *     paidAmountCents null — proving the dev payment provider never fakes a real payment.
 *  2. The same user cannot create a second entry for the same competition (unchanged
 *     duplicate-prevention behaviour, still enforced after the payment wiring).
 *  3. A closed competition rejects a new entry from a different user (unchanged
 *     lifecycle enforcement, still enforced after the payment wiring).
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

const API_URL = "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

const MARK = "qa-test-internal-phase16";

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
    body: JSON.stringify({ email, password: "qa-test-password-123", name: "QA Phase16" }),
  });
  if (!result.body.ok) throw new Error(`register failed for ${email}: ${JSON.stringify(result.body)}`);
  return result.body.data.token as string;
}

async function main() {
  console.log("=== PHASE 16 QA: payment-wired entry creation ===");

  // --- seed ---
  // Reuse the real dev DB's existing "nrl" sport row if one exists (it does, in any real
  // Perfect 2 dev DB with later phases' data already seeded) rather than assuming a
  // pristine database — sports.code is globally unique.
  const existingSport = (await db.select().from(schema.sports).where(eq(schema.sports.code, "nrl")))[0];
  const sportWasCreatedByThisRun = !existingSport;
  const sport = existingSport ?? (await db.insert(schema.sports).values({ code: "nrl", name: "QA National Rugby League" }).returning())[0];

  // Defensive pre-flight: a previous run that crashed before its own cleanup ran can leave
  // a QA season behind at this same fixed (sportId, year=2099) pair, which
  // seasons_sport_year_unique would then reject forever now that the sport row is reused.
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
  const [round] = await db.insert(schema.rounds).values({ seasonId: season.id, roundNumber: 1, name: `${MARK}-round`, status: "upcoming" }).returning();
  const [homeTeam] = await db.insert(schema.teams).values({ sportId: sport.id, name: `${MARK}-home`, shortName: "QAH", slug: `${MARK}-home` }).returning();
  const [awayTeam] = await db.insert(schema.teams).values({ sportId: sport.id, name: `${MARK}-away`, shortName: "QAA", slug: `${MARK}-away` }).returning();
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const [game] = await db
    .insert(schema.games)
    .values({ roundId: round.id, homeTeamId: homeTeam.id, awayTeamId: awayTeam.id, kickoff: future, status: "scheduled" })
    .returning();
  const [p1] = await db.insert(schema.players).values({ sportId: sport.id, teamId: homeTeam.id, firstName: "QA", lastName: "PlayerOne" }).returning();
  const [p2] = await db.insert(schema.players).values({ sportId: sport.id, teamId: awayTeam.id, firstName: "QA", lastName: "PlayerTwo" }).returning();
  await db.insert(schema.gameLineups).values([
    { gameId: game.id, teamId: homeTeam.id, playerId: p1.id, position: "Fullback" },
    { gameId: game.id, teamId: awayTeam.id, playerId: p2.id, position: "Fullback" },
  ]);
  const [competition] = await db
    .insert(schema.competitions)
    .values({ sportId: sport.id, roundId: round.id, name: `${MARK}-competition`, entryFeeCents: 500, status: "open" })
    .returning();

  console.log(`Seeded: sport=${sport.id} round=${round.id} game=${game.id} competition=${competition.id} (entryFeeCents=${competition.entryFeeCents})`);

  let cleanupUserIds: number[] = [];
  try {
    // --- check 1: successful entry, payment status honest ---
    const emailA = `${MARK}-a@perfect2.test`;
    const tokenA = await registerUser(emailA);
    const createResult = await api(`/api/nrl/rounds/${round.id}/entries`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ selections: [{ gameId: game.id, player1Id: p1.id, player2Id: p2.id }] }),
    });
    if (createResult.status !== 201 || !createResult.body.ok) {
      throw new Error(`FAIL check 1: entry creation failed: ${JSON.stringify(createResult.body)}`);
    }
    const entryId = createResult.body.data.entryId as number;
    const [entryRow] = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId));
    if (entryRow.paymentStatus !== "pending") throw new Error(`FAIL check 1: expected paymentStatus "pending", got "${entryRow.paymentStatus}"`);
    if (entryRow.paidAmountCents !== null) throw new Error(`FAIL check 1: expected paidAmountCents null, got ${entryRow.paidAmountCents}`);
    console.log("PASS check 1: entry created with paymentStatus=pending, paidAmountCents=null (no fake payment)");

    // --- check 2: duplicate entry still rejected ---
    const dupResult = await api(`/api/nrl/rounds/${round.id}/entries`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ selections: [{ gameId: game.id, player1Id: p1.id, player2Id: p2.id }] }),
    });
    if (dupResult.status === 201) throw new Error("FAIL check 2: duplicate entry was NOT rejected");
    console.log("PASS check 2: duplicate entry still rejected after payment wiring");

    // --- check 3: closed competition still rejects new entries ---
    await db.update(schema.competitions).set({ status: "closed" }).where(eq(schema.competitions.id, competition.id));
    const emailB = `${MARK}-b@perfect2.test`;
    const tokenB = await registerUser(emailB);
    const closedResult = await api(`/api/nrl/rounds/${round.id}/entries`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ selections: [{ gameId: game.id, player1Id: p1.id, player2Id: p2.id }] }),
    });
    if (closedResult.status === 201) throw new Error("FAIL check 3: entry into a closed competition was NOT rejected");
    console.log("PASS check 3: closed competition still rejects entry after payment wiring");

    const userA = await db.select().from(schema.users).where(eq(schema.users.email, emailA));
    const userB = await db.select().from(schema.users).where(eq(schema.users.email, emailB));
    cleanupUserIds = [...userA.map((u) => u.id), ...userB.map((u) => u.id)];

    console.log("=== ALL PHASE 16 PAYMENT-FLOW CHECKS PASSED ===");
  } finally {
    // --- cleanup: leaf -> root, unconditional ---
    console.log("Cleaning up QA data...");
    await db.delete(schema.entrySelections).where(eq(schema.entrySelections.gameId, game.id));
    const entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, competition.id));
    for (const e of entries) await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, e.id));
    await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, competition.id));
    await db.delete(schema.competitions).where(eq(schema.competitions.id, competition.id));
    await db.delete(schema.gameLineups).where(eq(schema.gameLineups.gameId, game.id));
    await db.delete(schema.games).where(eq(schema.games.id, game.id));
    await db.delete(schema.players).where(eq(schema.players.id, p1.id));
    await db.delete(schema.players).where(eq(schema.players.id, p2.id));
    await db.delete(schema.teams).where(eq(schema.teams.id, homeTeam.id));
    await db.delete(schema.teams).where(eq(schema.teams.id, awayTeam.id));
    await db.delete(schema.rounds).where(eq(schema.rounds.id, round.id));
    await db.delete(schema.seasons).where(eq(schema.seasons.id, season.id));
    if (sportWasCreatedByThisRun) await db.delete(schema.sports).where(eq(schema.sports.id, sport.id));
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
