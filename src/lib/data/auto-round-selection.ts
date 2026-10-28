import crypto from "node:crypto";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { safeQuery, type DataResult } from "./result";
import { getRoundShapeConfig } from "@/lib/perfect2/round-shape";
import { selectGamesForShape, type SelectableGame } from "@/lib/perfect2/game-selection";
import { sydneyWeekdayName, weekStartForInstant, nextWeekStart } from "@/lib/perfect2/week-window";
import { createRound, assignCandidatesToRound } from "./schedule-pool";
import { getSeasonById } from "./seasons";
import { syncPlayerEligibilityForGames } from "@/lib/sports-data/sync";
import { getNbaSportsDataProvider, getNflSportsDataProvider } from "@/lib/sports-data/registry";
import { logEvent } from "@/lib/monitoring/log";

export type RoundGameSelection = typeof schema.roundGameSelections.$inferSelect;

const REQUIRED_GAMES = 8;
const AUTO_SPORT_CODES = new Set(["nba", "nfl"]);
/** How many consecutive weeks to search forward before giving up — a generous ~2 seasons' worth, never an unbounded loop. */
const MAX_WEEKS_TO_SEARCH = 80;

export function isAutoSelectionSport(sportCode: string): boolean {
  return AUTO_SPORT_CODES.has(sportCode);
}

/** Lowercase day name in the app's canonical Australian display timezone (see src/lib/utils/format.ts) — the same zone used everywhere else a kickoff is shown to a human. */
function dayLabelInSydney(kickoff: Date): string {
  return sydneyWeekdayName(kickoff);
}

export interface EligibleGameSummary {
  gameId: number;
  homeTeamName: string;
  awayTeamName: string;
  kickoff: string;
  dayLabel: string | null;
}

/**
 * Real, synced, not-yet-curated games for ONE SPECIFIC (sportId, seasonId) — deliberately
 * narrower than schedule-pool.ts's listCandidateGames (which spans every season of a
 * sport): this randomiser must never let a game from a different season leak in (Perfect
 * Play Terms & product rule — see round-shape.ts's season-isolation note). "Eligible"
 * here means: still sitting in this season's schedule pool (never assigned to another
 * round), status "scheduled" (never live/final/postponed/cancelled), has a real kickoff
 * that hasn't passed yet, and has a real provider externalId (never a placeholder row).
 */
async function listEligibleGamesForAutoSelection(sportId: number, seasonId: number): Promise<DataResult<EligibleGameSummary[]>> {
  return safeQuery(async () => {
    const db = getDb();
    const poolRows = await db
      .select()
      .from(schema.rounds)
      .where(and(eq(schema.rounds.seasonId, seasonId), eq(schema.rounds.isSchedulePool, true)))
      .limit(1);
    const pool = poolRows[0];
    if (!pool) return [];

    const games = await db.select().from(schema.games).where(eq(schema.games.roundId, pool.id));
    const now = new Date();
    const teamIds = Array.from(new Set(games.flatMap((g) => [g.homeTeamId, g.awayTeamId])));
    const teams = teamIds.length ? await db.select().from(schema.teams).where(inArray(schema.teams.id, teamIds)) : [];
    const teamById = new Map(teams.map((t) => [t.id, t]));

    return games
      .filter((g) => g.status === "scheduled" && g.kickoff && new Date(g.kickoff) > now && !!g.externalId)
      .map((g) => ({
        gameId: g.id,
        homeTeamName: teamById.get(g.homeTeamId)?.name ?? "Unknown",
        awayTeamName: teamById.get(g.awayTeamId)?.name ?? "Unknown",
        kickoff: new Date(g.kickoff!).toISOString(),
        dayLabel: dayLabelInSydney(new Date(g.kickoff!)),
      }));
  });
}

/**
 * The latest (chronologically last) week_start_date already claimed by any selection
 * (generated OR locked — a regenerated-but-unlocked selection still owns its week until
 * explicitly deleted) for this sport/season, or null if none exists yet. Only meaningful
 * for day-bucketed sports; always null for NFL, which never sets week_start_date. Used to
 * make round numbers strictly chronological: the next round always searches starting the
 * week AFTER this one, never before it and never re-checking an already-claimed week.
 */
async function getMostRecentWeekStartDate(sportId: number, seasonId: number): Promise<DataResult<string | null>> {
  return safeQuery(async () => {
    const db = getDb();
    const rows = await db
      .select({ weekStartDate: schema.roundGameSelections.weekStartDate })
      .from(schema.roundGameSelections)
      .where(and(eq(schema.roundGameSelections.sportId, sportId), eq(schema.roundGameSelections.seasonId, seasonId), isNotNull(schema.roundGameSelections.weekStartDate)))
      .orderBy(desc(schema.roundGameSelections.weekStartDate))
      .limit(1);
    return rows[0]?.weekStartDate ?? null;
  });
}

export type GenerateSelectionResult =
  | { status: "ok"; selection: RoundGameSelection; alreadyExisted: boolean; games: EligibleGameSummary[] }
  | { status: "insufficient"; eligibleCount: number; required: number; details?: string[] }
  | { status: "invalid"; errors: string[] }
  | { status: "unavailable"; message: string };

/**
 * Generates (or, if one already exists for this exact round, simply returns it — see the
 * idempotency note on the roundGameSelections table) a seeded random 8-game selection for
 * one NBA/NFL round. Does NOT create the real `rounds` row or touch any game's `roundId` —
 * that only happens at lock time (lockRoundGameSelection). This is what lets an admin
 * regenerate freely before locking with zero customer-facing effect: nothing here is
 * visible to a customer yet.
 */
export async function generateRoundGameSelection(
  sportCode: string,
  sportId: number,
  seasonId: number,
  roundNumber: number,
  adminUserId: number,
): Promise<GenerateSelectionResult> {
  if (!isAutoSelectionSport(sportCode)) {
    return { status: "invalid", errors: [`Automatic game selection is only available for NBA and NFL, not "${sportCode}".`] };
  }

  // Never trust that seasonId actually belongs to sportId just because the caller says
  // so — verify server-side (section 20/22 of the brief: no cross-sport/cross-season
  // leakage, never trust an ID alone).
  const seasonResult = await getSeasonById(seasonId);
  if (seasonResult.status === "unavailable") return seasonResult;
  if (!seasonResult.data || seasonResult.data.sportId !== sportId) {
    return { status: "invalid", errors: [`Season ${seasonId} does not belong to this sport.`] };
  }

  const db = getDb();
  const existingResult = await safeQuery(() =>
    db
      .select()
      .from(schema.roundGameSelections)
      .where(and(eq(schema.roundGameSelections.sportId, sportId), eq(schema.roundGameSelections.seasonId, seasonId), eq(schema.roundGameSelections.roundNumber, roundNumber)))
      .limit(1),
  );
  if (existingResult.status === "unavailable") return existingResult;
  if (existingResult.data[0]) {
    const gamesResult = await describeSelectedGames(existingResult.data[0].selectedGameIds);
    return { status: "ok", selection: existingResult.data[0], alreadyExisted: true, games: gamesResult };
  }

  const eligibleResult = await listEligibleGamesForAutoSelection(sportId, seasonId);
  if (eligibleResult.status === "unavailable") return eligibleResult;
  const eligible = eligibleResult.data;

  const shape = getRoundShapeConfig(sportCode);
  const dayShape = shape.gamesPerDay && shape.roundDays ? { gamesPerDay: shape.gamesPerDay, roundDays: shape.roundDays } : null;

  const seed = crypto.randomBytes(32).toString("hex");

  let selection: ReturnType<typeof selectGamesForShape> | null = null;
  let weekStartDate: string | null = null;

  if (dayShape) {
    // Day-bucketed sports (NBA): a valid round is exactly 8 games, 2 per day, ALL drawn
    // from the SAME real Thursday-Sunday calendar week — never a scattered mix of
    // unrelated weeks/months (the bug this replaces: bucketing by day-of-week name alone
    // let "2 Thursdays" mean two Thursdays from two different months). Search forward
    // chronologically, starting the week after whichever week this sport/season's most
    // recently generated round already claimed — so round numbers stay strictly
    // chronological — or "this week" if no round has ever been generated yet.
    const priorWeekResult = await getMostRecentWeekStartDate(sportId, seasonId);
    if (priorWeekResult.status === "unavailable") return priorWeekResult;
    let searchWeek = priorWeekResult.data ? nextWeekStart(priorWeekResult.data) : weekStartForInstant(new Date(), dayShape.roundDays);

    const skipped: string[] = [];
    for (let i = 0; i < MAX_WEEKS_TO_SEARCH; i++) {
      const weekGames = eligible.filter((g) => weekStartForInstant(new Date(g.kickoff), dayShape.roundDays) === searchWeek);
      const selectable: SelectableGame[] = weekGames.map((g) => ({ gameId: g.gameId, dayLabel: g.dayLabel }));
      const attempt = selectGamesForShape(selectable, seed, REQUIRED_GAMES, dayShape);
      if (attempt.status === "ok") {
        selection = attempt;
        weekStartDate = searchWeek;
        break;
      }
      // Logged, not fabricated around — an admin can see exactly which weeks were
      // rejected and why, matching the product rule: never silently borrow games from
      // another week to force a full round.
      skipped.push(`week of ${searchWeek}: ${attempt.details?.join("; ") ?? `only ${attempt.eligibleCount} eligible, ${attempt.required} required`}`);
      searchWeek = nextWeekStart(searchWeek);
    }
    if (!selection) {
      logEvent("auto_selection_failed", { sportCode, sportId, seasonId, roundNumber, reason: "no_valid_week_found", weeksSearched: MAX_WEEKS_TO_SEARCH }, "warn");
      return {
        status: "insufficient",
        eligibleCount: eligible.length,
        required: REQUIRED_GAMES,
        details: [`No valid Thursday-Sunday week (2 eligible games/day) found in the next ${MAX_WEEKS_TO_SEARCH} weeks.`, ...skipped.slice(0, 10)],
      };
    }
  } else {
    const selectable: SelectableGame[] = eligible.map((g) => ({ gameId: g.gameId, dayLabel: g.dayLabel }));
    const attempt = selectGamesForShape(selectable, seed, REQUIRED_GAMES, dayShape);
    if (attempt.status === "insufficient") {
      logEvent("auto_selection_failed", { sportCode, sportId, seasonId, roundNumber, reason: "insufficient_eligible_games", eligibleCount: attempt.eligibleCount, required: attempt.required }, "warn");
      return { status: "insufficient", eligibleCount: attempt.eligibleCount, required: attempt.required, details: attempt.details };
    }
    selection = attempt;
  }

  // Race-safety: two concurrent "generate" calls for the same round both reach this insert;
  // the (sportId, seasonId, roundNumber) unique constraint lets only one succeed. The loser
  // re-reads and returns the winner's row rather than erroring — this is what makes
  // "generate" itself idempotent under real concurrency, not just under a single caller
  // calling it twice in sequence.
  const insertResult = await safeQuery(() =>
    db
      .insert(schema.roundGameSelections)
      .values({
        sportId,
        seasonId,
        roundNumber,
        seed,
        selectedGameIds: selection.selectedGameIds,
        weekStartDate,
        generatedByUserId: adminUserId,
      })
      .onConflictDoNothing({ target: [schema.roundGameSelections.sportId, schema.roundGameSelections.seasonId, schema.roundGameSelections.roundNumber] })
      .returning(),
  );
  if (insertResult.status === "unavailable") return insertResult;

  if (insertResult.data[0]) {
    const games = await describeSelectedGames(selection.selectedGameIds);
    return { status: "ok", selection: insertResult.data[0], alreadyExisted: false, games };
  }

  // Lost the race — read back whatever the winner actually persisted.
  const raceLoserResult = await safeQuery(() =>
    db
      .select()
      .from(schema.roundGameSelections)
      .where(and(eq(schema.roundGameSelections.sportId, sportId), eq(schema.roundGameSelections.seasonId, seasonId), eq(schema.roundGameSelections.roundNumber, roundNumber)))
      .limit(1),
  );
  if (raceLoserResult.status === "unavailable") return raceLoserResult;
  const winnerRow = raceLoserResult.data[0];
  const games = winnerRow ? await describeSelectedGames(winnerRow.selectedGameIds) : [];
  return { status: "ok", selection: winnerRow, alreadyExisted: true, games };
}

export type GetSelectionResult =
  | { status: "ok"; selection: RoundGameSelection; games: EligibleGameSummary[] }
  | { status: "not_found" }
  | { status: "unavailable"; message: string };

/** Reads back whatever selection (if any) exists for this round — for admin review UI polling. */
export async function getRoundGameSelection(sportId: number, seasonId: number, roundNumber: number): Promise<GetSelectionResult> {
  const db = getDb();
  const result = await safeQuery(() =>
    db
      .select()
      .from(schema.roundGameSelections)
      .where(and(eq(schema.roundGameSelections.sportId, sportId), eq(schema.roundGameSelections.seasonId, seasonId), eq(schema.roundGameSelections.roundNumber, roundNumber)))
      .limit(1),
  );
  if (result.status === "unavailable") return result;
  if (!result.data[0]) return { status: "not_found" };
  const games = await describeSelectedGames(result.data[0].selectedGameIds);
  return { status: "ok", selection: result.data[0], games };
}

export type RegenerateSelectionResult = GenerateSelectionResult | { status: "already_locked" };

/**
 * Discards a not-yet-locked selection and generates a fresh one — the ONLY way to change
 * an automated selection before it's locked. Explicitly rejected once locked (see
 * lockRoundGameSelection's doc comment for why post-lock changes are never silent).
 */
export async function regenerateRoundGameSelection(
  sportCode: string,
  sportId: number,
  seasonId: number,
  roundNumber: number,
  adminUserId: number,
): Promise<RegenerateSelectionResult> {
  const db = getDb();
  const existingResult = await safeQuery(() =>
    db
      .select()
      .from(schema.roundGameSelections)
      .where(and(eq(schema.roundGameSelections.sportId, sportId), eq(schema.roundGameSelections.seasonId, seasonId), eq(schema.roundGameSelections.roundNumber, roundNumber)))
      .limit(1),
  );
  if (existingResult.status === "unavailable") return existingResult;
  const existing = existingResult.data[0];
  if (existing && existing.status === "locked") return { status: "already_locked" };

  if (existing) {
    const deleteResult = await safeQuery(() => db.delete(schema.roundGameSelections).where(eq(schema.roundGameSelections.id, existing.id)));
    if (deleteResult.status === "unavailable") return deleteResult;
  }
  return generateRoundGameSelection(sportCode, sportId, seasonId, roundNumber, adminUserId);
}

export type LockSelectionResult =
  | { status: "ok"; roundId: number; alreadyLocked: boolean }
  | { status: "not_found" }
  | { status: "invalid"; errors: string[] }
  | { status: "unavailable"; message: string };

export interface LockSelectionInput {
  sportCode: string;
  sportId: number;
  seasonId: number;
  roundNumber: number;
  roundName: string;
  adminUserId: number;
}

/**
 * Turns a GENERATED selection into a real, customer-facing Perfect Play round — the one
 * point where this feature's games actually become visible/enterable, exactly mirroring
 * what the existing manual round-builder does (createRound + assignCandidatesToRound),
 * just with the 8 games chosen by generateRoundGameSelection instead of an admin's
 * checkboxes. Re-validates every selected game is STILL genuinely eligible (not started,
 * not cancelled/postponed) right before locking — time has passed since generation, and a
 * game going live or being called off between generate and lock must never be silently
 * dropped from an "exactly 8" selection (see game-selection.ts's insufficiency handling);
 * the admin must regenerate instead, never automatically substituted.
 *
 * Idempotent + concurrency-safe the same way settlement/rollover are elsewhere in this
 * codebase: the actual round-creating work only happens for whichever concurrent caller
 * wins an atomic `WHERE status = 'generated'` conditional update; the loser sees the
 * winner's already-created roundId instead of attempting a second round creation.
 */
export async function lockRoundGameSelection(input: LockSelectionInput): Promise<LockSelectionResult> {
  const db = getDb();
  const existingResult = await safeQuery(() =>
    db
      .select()
      .from(schema.roundGameSelections)
      .where(and(eq(schema.roundGameSelections.sportId, input.sportId), eq(schema.roundGameSelections.seasonId, input.seasonId), eq(schema.roundGameSelections.roundNumber, input.roundNumber)))
      .limit(1),
  );
  if (existingResult.status === "unavailable") return existingResult;
  const existing = existingResult.data[0];
  if (!existing) return { status: "not_found" };
  if (existing.status === "locked") {
    return existing.roundId ? { status: "ok", roundId: existing.roundId, alreadyLocked: true } : { status: "invalid", errors: ["Selection is marked locked but has no associated round — this should never happen."] };
  }

  // Re-check every selected game is still genuinely eligible right now.
  const gameRows = await db.select().from(schema.games).where(inArray(schema.games.id, existing.selectedGameIds));
  const now = new Date();
  const noLongerEligible = existing.selectedGameIds.filter((id) => {
    const g = gameRows.find((row) => row.id === id);
    return !g || g.status !== "scheduled" || !g.kickoff || new Date(g.kickoff) <= now;
  });
  if (noLongerEligible.length > 0) {
    logEvent("round_lock_failed", { sportCode: input.sportCode, sportId: input.sportId, seasonId: input.seasonId, roundNumber: input.roundNumber, reason: "games_no_longer_eligible", affectedCount: noLongerEligible.length }, "warn");
    return {
      status: "invalid",
      errors: [`${noLongerEligible.length} of the 8 selected games are no longer eligible (started, cancelled, or postponed) — regenerate the selection instead of locking. Affected game IDs: ${noLongerEligible.join(", ")}.`],
    };
  }

  const kickoffs = gameRows.map((g) => new Date(g.kickoff!));
  const startDate = new Date(Math.min(...kickoffs.map((d) => d.getTime()))).toISOString().slice(0, 10);
  const endDate = new Date(Math.max(...kickoffs.map((d) => d.getTime()))).toISOString().slice(0, 10);

  const shape = getRoundShapeConfig(input.sportCode);
  const dayShape = shape.gamesPerDay && shape.roundDays ? { gamesPerDay: shape.gamesPerDay, roundDays: shape.roundDays } : null;
  const assignments = existing.selectedGameIds.map((gameId) => {
    const g = gameRows.find((row) => row.id === gameId)!;
    return { gameId, slotLabel: dayShape ? dayLabelInSydney(new Date(g.kickoff!)) : null };
  });

  const roundResult = await createRound({ sportId: input.sportId, seasonId: input.seasonId, roundNumber: input.roundNumber, name: input.roundName, startDate, endDate });
  if (roundResult.status === "unavailable") {
    // A concurrent lock call may have already created this exact (seasonId, roundNumber)
    // round a moment ago — the rounds table's own unique constraint would make THIS
    // createRound call fail. Rather than assume a generic DB error, check whether the
    // selection is now actually locked (the real, self-healing outcome) before giving up.
    const recheck = await safeQuery(() => db.select().from(schema.roundGameSelections).where(eq(schema.roundGameSelections.id, existing.id)).limit(1));
    if (recheck.status === "ok" && recheck.data[0]?.status === "locked" && recheck.data[0].roundId) {
      return { status: "ok", roundId: recheck.data[0].roundId, alreadyLocked: true };
    }
    return roundResult;
  }
  const round = roundResult.data;

  const assignResult = await assignCandidatesToRound(input.sportCode, round.id, assignments);
  if (assignResult.status === "invalid") return { status: "invalid", errors: assignResult.errors };
  if (assignResult.status === "unavailable") return assignResult;

  // Atomic claim: only the caller whose UPDATE actually matches (status still "generated")
  // is the one who just created the real round above and should keep it; a concurrent
  // loser's WHERE clause would already be false as some other caller may have raced ahead,
  // so its RETURNING is empty and it must not treat the round it itself just built as real.
  const claimed = await safeQuery(() =>
    db
      .update(schema.roundGameSelections)
      .set({ status: "locked", lockedAt: new Date(), lockedByUserId: input.adminUserId, roundId: round.id })
      .where(and(eq(schema.roundGameSelections.id, existing.id), eq(schema.roundGameSelections.status, "generated")))
      .returning(),
  );
  if (claimed.status === "unavailable") return claimed;
  if (claimed.data[0]) {
    try {
      const provider = input.sportCode === "nba" ? getNbaSportsDataProvider() : getNflSportsDataProvider();
      await syncPlayerEligibilityForGames(provider, input.sportCode, existing.selectedGameIds);
    } catch (error) {
      // Player eligibility sync failing here is the same non-fatal condition the manual
      // round-builder already tolerates for its own create-round flow — the round is real
      // and locked either way. But unlike the manual flow (where the admin is staring at
      // the failure in the same request), this happens inside an admin-triggered lock
      // whose response doesn't surface this sub-step — a silent failure here means
      // customers can reach a brand-new round's entry screen with empty player lists for
      // some/all of its 8 games until someone notices and re-syncs. Log it loudly so it's
      // actually discoverable instead of only reactively found via a support complaint.
      logEvent(
        "missing_player_data",
        { roundId: round.id, sportCode: input.sportCode, gameCount: existing.selectedGameIds.length, message: error instanceof Error ? error.message : String(error) },
        "error",
      );
    }
    return { status: "ok", roundId: round.id, alreadyLocked: false };
  }

  // Lost the race: the round we just built above is an orphaned duplicate (a different
  // concurrent lock call won and its own round is the real one) — read back the winner's.
  const winnerResult = await safeQuery(() => db.select().from(schema.roundGameSelections).where(eq(schema.roundGameSelections.id, existing.id)).limit(1));
  if (winnerResult.status === "unavailable") return winnerResult;
  const winner = winnerResult.data[0];
  if (winner?.roundId && winner.roundId !== round.id) {
    await db.delete(schema.rounds).where(eq(schema.rounds.id, round.id));
  }
  return winner?.roundId ? { status: "ok", roundId: winner.roundId, alreadyLocked: true } : { status: "invalid", errors: ["Lock race resolution failed unexpectedly."] };
}

/** Real game/team details for display — sorted by kickoff, since selection order (shuffle order) must never leak into what the admin/customer sees. */
async function describeSelectedGames(gameIds: number[]): Promise<EligibleGameSummary[]> {
  if (gameIds.length === 0) return [];
  const db = getDb();
  const games = await db.select().from(schema.games).where(inArray(schema.games.id, gameIds));
  const teamIds = Array.from(new Set(games.flatMap((g) => [g.homeTeamId, g.awayTeamId])));
  const teams = teamIds.length ? await db.select().from(schema.teams).where(inArray(schema.teams.id, teamIds)) : [];
  const teamById = new Map(teams.map((t) => [t.id, t]));
  return games
    .map((g) => ({
      gameId: g.id,
      homeTeamName: teamById.get(g.homeTeamId)?.name ?? "Unknown",
      awayTeamName: teamById.get(g.awayTeamId)?.name ?? "Unknown",
      kickoff: g.kickoff ? new Date(g.kickoff).toISOString() : "",
      dayLabel: g.kickoff ? dayLabelInSydney(new Date(g.kickoff)) : null,
    }))
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
}
