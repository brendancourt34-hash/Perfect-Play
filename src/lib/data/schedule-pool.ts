import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { validateRoundShape, getRoundShapeConfig } from "@/lib/perfect2/round-shape";
import { weekStartForInstant } from "@/lib/perfect2/week-window";
import { safeQuery, type DataResult } from "./result";

/**
 * The "schedule pool" — Phase 22. For a sport that curates N real games out of a much
 * larger real slate (NBA today), synced-but-not-yet-curated games land in one persistent,
 * per-season holding round (rounds.isSchedulePool = true, roundNumber 0 — reserved, real
 * curated rounds start at 1) rather than a new table. An admin then assigns specific
 * candidates into a real customer-facing round; nobody ever enters the pool round itself
 * (getOrCreateCompetition is never called against it). This reuses 100% of the existing
 * games/rounds schema — no separate "NBA schedule" data model exists.
 */

export async function getOrCreateSchedulePoolRound(seasonId: number): Promise<DataResult<typeof schema.rounds.$inferSelect>> {
  return safeQuery(async () => {
    const db = getDb();
    const existing = await db
      .select()
      .from(schema.rounds)
      .where(and(eq(schema.rounds.seasonId, seasonId), eq(schema.rounds.isSchedulePool, true)))
      .limit(1);
    if (existing[0]) return existing[0];

    const inserted = await db
      .insert(schema.rounds)
      .values({ seasonId, roundNumber: 0, name: "Schedule pool", isSchedulePool: true })
      .returning();
    return inserted[0];
  });
}

export interface CandidateGame {
  gameId: number;
  homeTeamId: number;
  homeTeamName: string;
  awayTeamId: number;
  awayTeamName: string;
  kickoff: Date | null;
  status: string;
  externalId: string | null;
}

/** Every synced-but-uncurated real game for a sport within [startDate, endDate], inclusive. */
export async function listCandidateGames(sportId: number, startDate: Date, endDate: Date): Promise<DataResult<CandidateGame[]>> {
  return safeQuery(async () => {
    const db = getDb();
    const seasonRows = await db.select().from(schema.seasons).where(eq(schema.seasons.sportId, sportId));
    const seasonIds = seasonRows.map((s) => s.id);
    if (seasonIds.length === 0) return [];

    const poolRounds = await db
      .select()
      .from(schema.rounds)
      .where(and(inArray(schema.rounds.seasonId, seasonIds), eq(schema.rounds.isSchedulePool, true)));
    const poolRoundIds = poolRounds.map((r) => r.id);
    if (poolRoundIds.length === 0) return [];

    const games = await db
      .select()
      .from(schema.games)
      .where(and(inArray(schema.games.roundId, poolRoundIds), gte(schema.games.kickoff, startDate), lte(schema.games.kickoff, endDate)));
    if (games.length === 0) return [];

    const teamIds = Array.from(new Set(games.flatMap((g) => [g.homeTeamId, g.awayTeamId])));
    const teams = await db.select().from(schema.teams).where(inArray(schema.teams.id, teamIds));
    const teamById = new Map(teams.map((t) => [t.id, t]));

    return games
      .map((g) => ({
        gameId: g.id,
        homeTeamId: g.homeTeamId,
        homeTeamName: teamById.get(g.homeTeamId)?.name ?? "Unknown",
        awayTeamId: g.awayTeamId,
        awayTeamName: teamById.get(g.awayTeamId)?.name ?? "Unknown",
        kickoff: g.kickoff,
        status: g.status,
        externalId: g.externalId,
      }))
      .sort((a, b) => (a.kickoff?.getTime() ?? 0) - (b.kickoff?.getTime() ?? 0));
  });
}

export interface CreateRoundInput {
  sportId: number;
  seasonId: number;
  roundNumber: number;
  name: string;
  startDate: string;
  endDate: string;
}

export async function createRound(input: CreateRoundInput): Promise<DataResult<typeof schema.rounds.$inferSelect>> {
  return safeQuery(async () => {
    const db = getDb();
    const inserted = await db
      .insert(schema.rounds)
      .values({
        seasonId: input.seasonId,
        roundNumber: input.roundNumber,
        name: input.name,
        startDate: input.startDate,
        endDate: input.endDate,
      })
      .returning();
    return inserted[0];
  });
}

export type AssignCandidatesResult =
  | { status: "ok"; assigned: number }
  | { status: "invalid"; errors: string[] }
  | { status: "unavailable"; message: string };

/**
 * Assigns candidate games (from the schedule pool) into a real round, each with a slot
 * label (e.g. "thursday"). Validated against the sport's round shape (src/lib/perfect2/
 * round-shape.ts) BEFORE anything is written — an NBA round that isn't exactly 8 games,
 * 2 per day, is rejected outright, never partially assigned. Only ever moves a game OUT
 * of the schedule pool (WHERE roundId = the pool round) — can't accidentally steal a game
 * another round already curated.
 */
export async function assignCandidatesToRound(
  sportCode: string,
  roundId: number,
  assignments: readonly { gameId: number; slotLabel: string | null }[],
): Promise<AssignCandidatesResult> {
  // For a day-bucketed sport (NBA), independently re-derive which real calendar week
  // each candidate's own kickoff actually falls in — never trust the caller's slotLabel
  // alone — so the same-week check below can catch a scattered-across-months round even
  // if it somehow got this far (e.g. a manual admin curation attempt, not just the auto
  // generator, which is already fixed to never produce one).
  const shape = getRoundShapeConfig(sportCode);
  let weekStartDateByGameId = new Map<number, string | null>();
  if (shape.roundDays) {
    const db = getDb();
    const gameRows = await db
      .select({ id: schema.games.id, kickoff: schema.games.kickoff })
      .from(schema.games)
      .where(inArray(schema.games.id, assignments.map((a) => a.gameId)));
    weekStartDateByGameId = new Map(gameRows.map((g) => [g.id, g.kickoff ? weekStartForInstant(new Date(g.kickoff), shape.roundDays!) : null]));
  }
  const shapeCheck = validateRoundShape(
    sportCode,
    assignments.map((a) => ({ slotLabel: a.slotLabel, weekStartDate: shape.roundDays ? (weekStartDateByGameId.get(a.gameId) ?? null) : undefined })),
  );
  if (!shapeCheck.valid) return { status: "invalid", errors: shapeCheck.errors };

  const result = await safeQuery(async () => {
    const db = getDb();
    const roundRows = await db.select().from(schema.rounds).where(eq(schema.rounds.id, roundId)).limit(1);
    const round = roundRows[0];
    if (!round) throw new Error("Round not found.");

    const poolRoundRows = await db
      .select()
      .from(schema.rounds)
      .where(and(eq(schema.rounds.seasonId, round.seasonId), eq(schema.rounds.isSchedulePool, true)))
      .limit(1);
    const poolRound = poolRoundRows[0];
    if (!poolRound) throw new Error("No schedule pool exists for this season yet — sync the schedule first.");

    let assigned = 0;
    for (const a of assignments) {
      const updated = await db
        .update(schema.games)
        .set({ roundId, slotLabel: a.slotLabel })
        .where(and(eq(schema.games.id, a.gameId), eq(schema.games.roundId, poolRound.id)))
        .returning();
      if (updated[0]) assigned++;
    }
    return assigned;
  });

  if (result.status === "unavailable") return result;
  if (result.data !== assignments.length) {
    return { status: "invalid", errors: [`Only ${result.data} of ${assignments.length} candidate games could be assigned — one or more may already belong to another round.`] };
  }
  return { status: "ok", assigned: result.data };
}

/** Games still sitting in a round's schedule pool that were never assigned anywhere — for admin visibility only. */
export async function countUnassignedInPool(seasonId: number): Promise<DataResult<number>> {
  return safeQuery(async () => {
    const db = getDb();
    const poolRows = await db
      .select()
      .from(schema.rounds)
      .where(and(eq(schema.rounds.seasonId, seasonId), eq(schema.rounds.isSchedulePool, true)))
      .limit(1);
    const pool = poolRows[0];
    if (!pool) return 0;
    const games = await db.select().from(schema.games).where(and(eq(schema.games.roundId, pool.id), isNull(schema.games.slotLabel)));
    return games.length;
  });
}
