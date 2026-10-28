/**
 * PHASE 23H — proves the getOrCreateCompetition race fix: N different users all racing
 * to be the very FIRST entrant into a brand-new round (the exact scenario where the
 * competition row doesn't exist yet) must all succeed with their own real entry, and
 * exactly ONE competitions row must ever be created — never a 503 "unavailable" for the
 * concurrent losers of the old unguarded INSERT.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
const MARK = `qa23h-firstentry-${Date.now()}`;
const TEST_YEAR = 2500 + (Date.now() % 900);
const API = "http://localhost:3000";
const N = 10;

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
  const [teamA] = await db.insert(schema.teams).values({ sportId: sport.id, slug: `${MARK}-a`, name: "First A", shortName: "FA" }).returning();
  const [teamB] = await db.insert(schema.teams).values({ sportId: sport.id, slug: `${MARK}-b`, name: "First B", shortName: "FB" }).returning();
  const [game] = await db
    .insert(schema.games)
    .values({ roundId: round.id, homeTeamId: teamA.id, awayTeamId: teamB.id, kickoff: new Date(Date.now() + 3600_000), status: "scheduled" })
    .returning();
  const [scorer] = await db.insert(schema.players).values({ sportId: sport.id, teamId: teamA.id, firstName: MARK, lastName: "Scorer", position: "Any" }).returning();
  await db.insert(schema.gameLineups).values({ gameId: game.id, playerId: scorer.id, teamId: teamA.id, position: "Any" });

  // N distinct users, each registered and funded, none has entered anything yet — this
  // round's competitions row does not exist until the very first of these calls creates it.
  const users = await Promise.all(
    Array.from({ length: N }, async (_, i) => {
      const email = `${MARK}-user${i}@example.com`;
      const reg = await fetch(`${API}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "qa-test-password-123", name: `First ${i}` }) }).then((r) => r.json());
      return { userId: reg.data.user.id as number, token: reg.data.token as string };
    }),
  );

  const results = await Promise.all(
    users.map((u) =>
      fetch(`${API}/api/nrl/rounds/${round.id}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${u.token}` },
        body: JSON.stringify({ selections: [{ gameId: game.id, playerIds: [scorer.id] }] }),
      }).then(async (r) => ({ status: r.status, body: await r.json() })),
    ),
  );

  const statuses = results.map((r) => r.status);
  const unavailableCount = statuses.filter((s) => s === 503).length;
  const successCount = statuses.filter((s) => s === 201).length;
  console.log("statuses:", statuses);

  assert(unavailableCount === 0, `zero concurrent first-entrants get a raw 503 unavailable (got ${unavailableCount}) — the race no longer produces an unhandled unique-violation`);
  assert(successCount === N, `all ${N} distinct first-time entrants succeed with a real entry (got ${successCount})`);

  const comps = await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, round.id));
  assert(comps.length === 1, `exactly one competitions row was created for this round despite ${N} concurrent racers (got ${comps.length})`);

  const entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, comps[0].id));
  assert(entries.length === N, `all ${N} entries are correctly linked to that single competition row (got ${entries.length})`);

  console.log(`\n${passed} checks passed`);

  // cleanup
  const entryIds = entries.map((e) => e.id);
  if (entryIds.length) {
    for (const id of entryIds) await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, id));
    await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, comps[0].id));
  }
  for (const u of users) await db.delete(schema.paymentTransactions).where(eq(schema.paymentTransactions.userId, u.userId));
  await db.delete(schema.competitions).where(eq(schema.competitions.roundId, round.id));
  await db.delete(schema.gameLineups).where(eq(schema.gameLineups.gameId, game.id));
  await db.delete(schema.games).where(eq(schema.games.id, game.id));
  await db.delete(schema.players).where(eq(schema.players.id, scorer.id));
  await db.delete(schema.teams).where(eq(schema.teams.id, teamA.id));
  await db.delete(schema.teams).where(eq(schema.teams.id, teamB.id));
  await db.delete(schema.rounds).where(eq(schema.rounds.id, round.id));
  await db.delete(schema.seasons).where(eq(schema.seasons.id, season.id));
  for (const u of users) {
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
