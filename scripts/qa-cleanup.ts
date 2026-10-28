/**
 * PHASE 13 QA CLEANUP — removes every row created for this QA run.
 *
 * Deletes by matching the QA markers used throughout seeding (sports.code in ('nrl','afl')
 * — the only sports this run ever created — and users.email LIKE 'qa-test-internal%'),
 * not by trusting captured IDs alone, so this is safe to re-run and doesn't depend on
 * remembering exact row numbers. Explicit dependency-ordered deletes (leaf tables first)
 * rather than relying solely on ON DELETE CASCADE, so the script is auditable and doesn't
 * depend on reasoning about cascade resolution order.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { inArray, like } from "drizzle-orm";
import * as schema from "../src/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

async function main() {
  const sports = await db.select().from(schema.sports).where(inArray(schema.sports.code, ["nrl", "afl"]));
  const sportIds = sports.map((s) => s.id);
  const users = await db.select().from(schema.users).where(like(schema.users.email, "qa-test-internal%@perfect2.test"));
  const userIds = users.map((u) => u.id);

  console.log(`Found ${sportIds.length} QA sport(s), ${userIds.length} QA user(s).`);
  if (sportIds.length === 0 && userIds.length === 0) {
    console.log("Nothing to clean up.");
    return;
  }

  const seasons = sportIds.length ? await db.select().from(schema.seasons).where(inArray(schema.seasons.sportId, sportIds)) : [];
  const seasonIds = seasons.map((s) => s.id);
  const rounds = seasonIds.length ? await db.select().from(schema.rounds).where(inArray(schema.rounds.seasonId, seasonIds)) : [];
  const roundIds = rounds.map((r) => r.id);
  const games = roundIds.length ? await db.select().from(schema.games).where(inArray(schema.games.roundId, roundIds)) : [];
  const gameIds = games.map((g) => g.id);
  const teams = sportIds.length ? await db.select().from(schema.teams).where(inArray(schema.teams.sportId, sportIds)) : [];
  const teamIds = teams.map((t) => t.id);
  const players = sportIds.length ? await db.select().from(schema.players).where(inArray(schema.players.sportId, sportIds)) : [];
  const playerIds = players.map((p) => p.id);
  const competitions = sportIds.length ? await db.select().from(schema.competitions).where(inArray(schema.competitions.sportId, sportIds)) : [];
  const competitionIds = competitions.map((c) => c.id);
  const entries = competitionIds.length
    ? await db.select().from(schema.competitionEntries).where(inArray(schema.competitionEntries.competitionId, competitionIds))
    : [];
  const entryIds = entries.map((e) => e.id);

  // Leaf → root order.
  if (entryIds.length) await db.delete(schema.entrySelections).where(inArray(schema.entrySelections.entryId, entryIds));
  if (entryIds.length) await db.delete(schema.competitionEntries).where(inArray(schema.competitionEntries.id, entryIds));
  if (competitionIds.length) await db.delete(schema.competitions).where(inArray(schema.competitions.id, competitionIds));
  if (gameIds.length) await db.delete(schema.playerGameStats).where(inArray(schema.playerGameStats.gameId, gameIds));
  if (gameIds.length) await db.delete(schema.gameLineups).where(inArray(schema.gameLineups.gameId, gameIds));
  if (gameIds.length) await db.delete(schema.games).where(inArray(schema.games.id, gameIds));
  if (playerIds.length) await db.delete(schema.players).where(inArray(schema.players.id, playerIds));
  if (teamIds.length) await db.delete(schema.teams).where(inArray(schema.teams.id, teamIds));
  if (roundIds.length) await db.delete(schema.rounds).where(inArray(schema.rounds.id, roundIds));
  if (seasonIds.length) await db.delete(schema.seasons).where(inArray(schema.seasons.id, seasonIds));
  if (sportIds.length) await db.delete(schema.sports).where(inArray(schema.sports.id, sportIds));
  if (userIds.length) await db.delete(schema.sessions).where(inArray(schema.sessions.userId, userIds));
  if (userIds.length) await db.delete(schema.users).where(inArray(schema.users.id, userIds));

  console.log("Deleted:", {
    entrySelections: entryIds.length,
    competitionEntries: entryIds.length,
    competitions: competitionIds.length,
    games: gameIds.length,
    players: playerIds.length,
    teams: teamIds.length,
    rounds: roundIds.length,
    seasons: seasonIds.length,
    sports: sportIds.length,
    users: userIds.length,
  });
}

main().catch((err) => {
  console.error("QA cleanup failed:", err);
  process.exit(1);
});
