/**
 * PHASE 23H — live concurrency test: fires N simultaneous createEntry requests for the
 * SAME user + same round, and verifies at most one entry (and one paid transaction)
 * survives, closing the TOCTOU race between the "existing entry" check and the insert.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
const MARK = `qa23h-race-${Date.now()}`;
const API = "http://localhost:3000";
const CONCURRENCY = 15;

async function main() {
  const [sport] = await db.select().from(schema.sports).where(eq(schema.sports.code, "nrl")).limit(1);
  const [season] = await db.insert(schema.seasons).values({ sportId: sport.id, year: 2099, label: MARK }).returning();
  const [round] = await db.insert(schema.rounds).values({ seasonId: season.id, roundNumber: 1, name: MARK }).returning();
  const [teamA] = await db.insert(schema.teams).values({ sportId: sport.id, slug: `${MARK}-a`, name: "Race A", shortName: "RCA" }).returning();
  const [teamB] = await db.insert(schema.teams).values({ sportId: sport.id, slug: `${MARK}-b`, name: "Race B", shortName: "RCB" }).returning();
  const [game] = await db
    .insert(schema.games)
    .values({ roundId: round.id, homeTeamId: teamA.id, awayTeamId: teamB.id, kickoff: new Date(Date.now() + 3600_000), status: "scheduled" })
    .returning();
  const [player] = await db.insert(schema.players).values({ sportId: sport.id, teamId: teamA.id, firstName: MARK, lastName: "Player", position: "Any" }).returning();
  await db.insert(schema.gameLineups).values({ gameId: game.id, playerId: player.id, teamId: teamA.id, position: "Any" });

  const email = `${MARK}@example.com`;
  const registerRes = await fetch(`${API}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "qa-test-password-123", name: "Race QA" }),
  }).then((r) => r.json());
  const token = registerRes.data.token;
  const userId = registerRes.data.user.id;

  console.log(`Firing ${CONCURRENCY} concurrent createEntry requests for the same user+round...`);
  const requests = Array.from({ length: CONCURRENCY }, () =>
    fetch(`${API}/api/nrl/rounds/${round.id}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ selections: [{ gameId: game.id, playerIds: [player.id] }] }),
    }).then((r) => r.json().then((body) => ({ status: r.status, body }))),
  );
  const results = await Promise.all(requests);

  const successes = results.filter((r) => r.status === 201);
  const rejections = results.filter((r) => r.status !== 201);
  console.log(`successes: ${successes.length}, rejections: ${rejections.length}`);

  const entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.userId, userId));
  const transactions = await db.select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.userId, userId));

  let passed = 0;
  function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error("FAIL: " + msg);
    console.log("PASS: " + msg);
    passed++;
  }

  assert(successes.length === 1, `exactly 1 of ${CONCURRENCY} concurrent requests succeeded (got ${successes.length})`);
  assert(rejections.length === CONCURRENCY - 1, `the other ${CONCURRENCY - 1} were rejected, not silently duplicated`);
  assert(entries.length === 1, `exactly 1 competition_entries row exists in the DB for this user+round (got ${entries.length})`);
  assert(transactions.length === 1, `exactly 1 payment_transactions row exists — no double-charge (got ${transactions.length})`);
  assert(entries[0].paymentStatus === transactions[0].status, `the entry's paymentStatus (${entries[0].paymentStatus}) matches its transaction's status (${transactions[0].status}) — no duplicate-charge divergence`);
  assert(
    transactions[0].competitionEntryId === entries[0].id,
    "the transaction's competitionEntryId correctly points to the surviving entry",
  );

  console.log(`\n${passed} checks passed`);

  // cleanup
  const entryIds = entries.map((e) => e.id);
  for (const id of entryIds) await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, id));
  for (const id of entryIds) await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.id, id));
  for (const t of transactions) await db.delete(schema.paymentTransactions).where(eq(schema.paymentTransactions.id, t.id));
  await db.delete(schema.gameLineups).where(eq(schema.gameLineups.gameId, game.id));
  await db.delete(schema.games).where(eq(schema.games.id, game.id));
  await db.delete(schema.players).where(eq(schema.players.id, player.id));
  await db.delete(schema.teams).where(eq(schema.teams.id, teamA.id));
  await db.delete(schema.teams).where(eq(schema.teams.id, teamB.id));
  await db.delete(schema.rounds).where(eq(schema.rounds.id, round.id));
  await db.delete(schema.seasons).where(eq(schema.seasons.id, season.id));
  const sessions = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId));
  for (const s of sessions) await db.delete(schema.sessions).where(eq(schema.sessions.id, s.id));
  await db.delete(schema.users).where(eq(schema.users.id, userId));
  console.log("cleaned up");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
