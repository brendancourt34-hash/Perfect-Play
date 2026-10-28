import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { voidPendingSelectionsForGame } from "@/lib/data/void";
import type { SportsDataProvider } from "./provider";
import { mapExternalGameStatus } from "./status";
import {
  findDuplicateExternalIds,
  findDuplicateGamePlayerAssociations,
  validateGame,
  validateGamePlayerAssociation,
  validatePlayer,
  validatePlayerGameStat,
  validateTeam,
} from "./validate";
import type { NormalizedGame, NormalizedGameStatus, NormalizedPlayer } from "./types";

/**
 * Idempotent provider → database sync. Every write here is a real Postgres upsert keyed
 * on the relevant table's `externalId` (or, for lineups/stats, the natural
 * (gameId, playerId) unique constraint already on those tables) — running any of these
 * functions twice with the same provider data updates the same rows, it never duplicates
 * them. That guarantee comes from the database's own unique constraints via
 * `onConflictDoUpdate`, not from application-level bookkeeping.
 *
 * A provider's raw status vocabulary must be mapped explicitly — see DEFAULT_STATUS_MAPPING
 * below. This is deliberately not wired to any real provider yet; callers pass in a
 * SportsDataProvider (e.g. the Champion Data boundary adapter, once it exists, or the mock
 * provider in tests).
 */

/**
 * Placeholder status vocabulary — intentionally NOT modeled on Champion Data's real status
 * strings, since those aren't known yet. Replace with the provider's actual values once
 * API documentation is available; mapExternalGameStatus throws on anything unmapped rather
 * than guessing, so an incomplete mapping fails loudly instead of silently mis-tagging games.
 */
const PLACEHOLDER_STATUS_MAPPING: Record<string, NormalizedGameStatus> = {
  scheduled: "scheduled",
  live: "live",
  final: "final",
  postponed: "postponed",
  cancelled: "cancelled",
};

export interface SyncSummary {
  inserted: number;
  updated: number;
  errors: string[];
  /** Selections voided because a resync reported a game newly transitioning to "cancelled" — see upsertGamesIntoRound. */
  selectionsVoided: number;
}

function emptySummary(): SyncSummary {
  return { inserted: 0, updated: 0, errors: [], selectionsVoided: 0 };
}

export async function syncSeasons(provider: SportsDataProvider, sportCode: string): Promise<SyncSummary> {
  const db = getDb();
  const summary = emptySummary();

  const sportRows = await db.select().from(schema.sports).where(eq(schema.sports.code, sportCode)).limit(1);
  const sport = sportRows[0];
  if (!sport) {
    summary.errors.push(`Sport "${sportCode}" doesn't exist yet — create it before syncing.`);
    return summary;
  }

  const seasons = await provider.listSeasons(sportCode);
  const duplicates = findDuplicateExternalIds(seasons);
  if (duplicates.length > 0) summary.errors.push(`Duplicate season provider IDs: ${duplicates.join(", ")}`);

  for (const season of seasons) {
    const existing = await db.select().from(schema.seasons).where(eq(schema.seasons.externalId, season.externalId)).limit(1);
    await db
      .insert(schema.seasons)
      .values({ sportId: sport.id, year: season.year, label: season.label, externalId: season.externalId })
      .onConflictDoUpdate({
        target: schema.seasons.externalId,
        set: { year: season.year, label: season.label },
      });
    if (existing[0]) summary.updated++;
    else summary.inserted++;
  }

  return summary;
}

export async function syncRounds(provider: SportsDataProvider, seasonExternalId: string): Promise<SyncSummary> {
  const db = getDb();
  const summary = emptySummary();

  const seasonRows = await db.select().from(schema.seasons).where(eq(schema.seasons.externalId, seasonExternalId)).limit(1);
  const season = seasonRows[0];
  if (!season) {
    summary.errors.push(`Season "${seasonExternalId}" hasn't been synced yet — run syncSeasons first.`);
    return summary;
  }

  const rounds = await provider.listRounds(seasonExternalId);
  const duplicates = findDuplicateExternalIds(rounds);
  if (duplicates.length > 0) summary.errors.push(`Duplicate round provider IDs: ${duplicates.join(", ")}`);

  for (const round of rounds) {
    const existing = await db.select().from(schema.rounds).where(eq(schema.rounds.externalId, round.externalId)).limit(1);
    await db
      .insert(schema.rounds)
      .values({
        seasonId: season.id,
        roundNumber: round.roundNumber,
        name: round.name,
        startDate: round.startDate,
        endDate: round.endDate,
        externalId: round.externalId,
      })
      .onConflictDoUpdate({
        target: schema.rounds.externalId,
        set: { roundNumber: round.roundNumber, name: round.name, startDate: round.startDate, endDate: round.endDate },
      });
    if (existing[0]) summary.updated++;
    else summary.inserted++;
  }

  return summary;
}

export async function syncTeams(provider: SportsDataProvider, sportCode: string): Promise<SyncSummary> {
  const db = getDb();
  const summary = emptySummary();

  const sportRows = await db.select().from(schema.sports).where(eq(schema.sports.code, sportCode)).limit(1);
  const sport = sportRows[0];
  if (!sport) {
    summary.errors.push(`Sport "${sportCode}" doesn't exist yet — create it before syncing.`);
    return summary;
  }

  const teams = await provider.listTeams(sportCode);
  for (const team of teams) {
    const check = validateTeam(team);
    if (!check.valid) {
      summary.errors.push(...check.errors);
      continue;
    }
    const existing = await db.select().from(schema.teams).where(eq(schema.teams.externalId, team.externalId)).limit(1);
    const slug = team.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    await db
      .insert(schema.teams)
      .values({ sportId: sport.id, name: team.name, shortName: team.shortName, slug, logoUrl: team.logoUrl, externalId: team.externalId })
      .onConflictDoUpdate({
        target: schema.teams.externalId,
        set: { name: team.name, shortName: team.shortName, logoUrl: team.logoUrl },
      });
    if (existing[0]) summary.updated++;
    else summary.inserted++;
  }

  return summary;
}

/**
 * Shared upsert body for "a batch of normalized games belongs in this specific round" —
 * used by both syncGames (NRL/AFL: round comes from the provider's own round concept) and
 * syncGamesForDateRange (NBA: round is the sport's schedule-pool holding round — see
 * src/lib/data/schedule-pool.ts). Neither caller duplicates this logic.
 */
async function upsertGamesIntoRound(games: NormalizedGame[], roundId: number, summary: SyncSummary): Promise<void> {
  const db = getDb();
  const duplicates = findDuplicateExternalIds(games);
  if (duplicates.length > 0) summary.errors.push(`Duplicate game provider IDs: ${duplicates.join(", ")}`);

  for (const game of games) {
    const check = validateGame(game);
    if (!check.valid) {
      summary.errors.push(...check.errors);
      continue;
    }

    const [homeTeamRows, awayTeamRows] = await Promise.all([
      db.select().from(schema.teams).where(eq(schema.teams.externalId, game.homeTeamExternalId)).limit(1),
      db.select().from(schema.teams).where(eq(schema.teams.externalId, game.awayTeamExternalId)).limit(1),
    ]);
    if (!homeTeamRows[0] || !awayTeamRows[0]) {
      summary.errors.push(`Game ${game.externalId}: home/away team hasn't been synced yet — run syncTeams first.`);
      continue;
    }

    const status = mapExternalGameStatus(game.status, PLACEHOLDER_STATUS_MAPPING);
    const existing = await db.select().from(schema.games).where(eq(schema.games.externalId, game.externalId)).limit(1);
    await db
      .insert(schema.games)
      .values({
        roundId,
        homeTeamId: homeTeamRows[0].id,
        awayTeamId: awayTeamRows[0].id,
        kickoff: game.kickoff ? new Date(game.kickoff) : null,
        venue: game.venue,
        status,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        externalId: game.externalId,
      })
      .onConflictDoUpdate({
        target: schema.games.externalId,
        // Deliberately does NOT overwrite roundId/slotLabel here — once a game has been
        // curated into a real Perfect Play round (see schedule-pool.ts), a later re-sync of
        // the schedule pool must never move it back. Only the game's own real-world facts
        // (kickoff/venue/status/score) are ever refreshed by a resync.
        set: {
          kickoff: game.kickoff ? new Date(game.kickoff) : null,
          venue: game.venue,
          status,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
        },
      });
    if (existing[0]) summary.updated++;
    else summary.inserted++;

    // A game the provider now reports as "cancelled" (and wasn't already) will never
    // become "final", so it would otherwise never get scored — see
    // voidPendingSelectionsForGame's doc comment for why this would strand entries in
    // permanent "pending" limbo. Mirrors exactly what an admin's manual voidGame action
    // does, applied automatically the moment a resync reveals a real-world cancellation.
    if (status === "cancelled" && existing[0]?.status !== "cancelled") {
      const gameId = existing[0]?.id;
      if (gameId) summary.selectionsVoided += await voidPendingSelectionsForGame(gameId);
    }
  }
}

export async function syncGames(provider: SportsDataProvider, roundExternalId: string): Promise<SyncSummary> {
  const db = getDb();
  const summary = emptySummary();

  const roundRows = await db.select().from(schema.rounds).where(eq(schema.rounds.externalId, roundExternalId)).limit(1);
  const round = roundRows[0];
  if (!round) {
    summary.errors.push(`Round "${roundExternalId}" hasn't been synced yet — run syncRounds first.`);
    return summary;
  }

  const games = await provider.listGames(roundExternalId);
  await upsertGamesIntoRound(games, round.id, summary);
  return summary;
}

/**
 * For a provider with no upstream "round" concept (NBA) — fetches real games across a
 * date range and upserts them into the given round (expected to be the sport's
 * schedule-pool holding round; see src/lib/data/schedule-pool.ts, which is what actually
 * resolves that round's id). The provider must implement the optional
 * listGamesByDateRange method; a provider that doesn't throws a clear error instead of
 * silently doing nothing.
 */
export async function syncGamesForDateRange(
  provider: SportsDataProvider,
  holdingRoundId: number,
  startIso: string,
  endIso: string,
): Promise<SyncSummary> {
  const summary = emptySummary();
  if (!provider.listGamesByDateRange) {
    summary.errors.push(`Provider "${provider.name}" does not support date-range syncing (listGamesByDateRange is not implemented).`);
    return summary;
  }
  const games = await provider.listGamesByDateRange(startIso, endIso);
  await upsertGamesIntoRound(games, holdingRoundId, summary);
  return summary;
}

/**
 * For a provider WITH an upstream "round" concept (NRL/AFL — a real round's games come
 * straight from the provider) — fetches that round's real games and upserts them into
 * the sport's schedule-pool holding round (see src/lib/data/schedule-pool.ts) instead of
 * directly into a customer-facing round, so an admin can curate a SUBSET of them into an
 * actual Perfect Play round exactly like NBA's date-range flow does. This is what makes
 * "how many games are in this week's Perfect Play round" a round-level admin choice rather
 * than an automatic mirror of the official fixture — e.g. a State of Origin week with
 * only 6 suitable games instead of the usual 8. Same shared upsert body as syncGames, so
 * a game synced this way and one synced the old direct way behave identically once
 * curated — no second data model.
 */
export async function syncProviderGamesIntoPool(provider: SportsDataProvider, holdingRoundId: number, providerRoundExternalId: string): Promise<SyncSummary> {
  const summary = emptySummary();
  const games = await provider.listGames(providerRoundExternalId);
  await upsertGamesIntoRound(games, holdingRoundId, summary);
  return summary;
}

/** Upserts a team's player records (real name/position from the provider — never synthesized). */
export async function syncPlayers(provider: SportsDataProvider, sportCode: string, teamExternalId: string): Promise<SyncSummary> {
  const db = getDb();
  const summary = emptySummary();

  const [sportRows, teamRows] = await Promise.all([
    db.select().from(schema.sports).where(eq(schema.sports.code, sportCode)).limit(1),
    db.select().from(schema.teams).where(eq(schema.teams.externalId, teamExternalId)).limit(1),
  ]);
  if (!sportRows[0]) {
    summary.errors.push(`Sport "${sportCode}" doesn't exist yet — create it before syncing.`);
    return summary;
  }
  if (!teamRows[0]) {
    summary.errors.push(`Team "${teamExternalId}" hasn't been synced yet — run syncTeams first.`);
    return summary;
  }

  const players: NormalizedPlayer[] = await provider.listPlayers(teamExternalId);
  const duplicates = findDuplicateExternalIds(players);
  if (duplicates.length > 0) summary.errors.push(`Duplicate player provider IDs: ${duplicates.join(", ")}`);

  for (const player of players) {
    const check = validatePlayer(player);
    if (!check.valid) {
      summary.errors.push(...check.errors);
      continue;
    }
    const existing = await db.select().from(schema.players).where(eq(schema.players.externalId, player.externalId)).limit(1);
    await db
      .insert(schema.players)
      .values({
        sportId: sportRows[0].id,
        teamId: teamRows[0].id,
        firstName: player.firstName,
        lastName: player.lastName,
        position: player.position,
        photoUrl: player.photoUrl,
        externalId: player.externalId,
      })
      .onConflictDoUpdate({
        target: schema.players.externalId,
        set: { teamId: teamRows[0].id, firstName: player.firstName, lastName: player.lastName, position: player.position, photoUrl: player.photoUrl },
      });
    if (existing[0]) summary.updated++;
    else summary.inserted++;
  }

  return summary;
}

/** Associates already-synced players with a game — this IS the eligibility pool for that game. */
export async function syncGamePlayers(provider: SportsDataProvider, sportCode: string, gameExternalId: string): Promise<SyncSummary> {
  const db = getDb();
  const summary = emptySummary();

  const [sportRows, gameRows] = await Promise.all([
    db.select().from(schema.sports).where(eq(schema.sports.code, sportCode)).limit(1),
    db.select().from(schema.games).where(eq(schema.games.externalId, gameExternalId)).limit(1),
  ]);
  const sport = sportRows[0];
  const game = gameRows[0];
  if (!sport) {
    summary.errors.push(`Sport "${sportCode}" doesn't exist yet — create it before syncing.`);
    return summary;
  }
  if (!game) {
    summary.errors.push(`Game "${gameExternalId}" hasn't been synced yet — run syncGames first.`);
    return summary;
  }

  const associations = await provider.listGamePlayers(gameExternalId);
  const duplicates = findDuplicateGamePlayerAssociations(associations);
  if (duplicates.length > 0) summary.errors.push(`Duplicate player-game associations: ${duplicates.join(", ")}`);

  for (const association of associations) {
    const check = validateGamePlayerAssociation(association);
    if (!check.valid) {
      summary.errors.push(...check.errors);
      continue;
    }

    const teamRows = await db.select().from(schema.teams).where(eq(schema.teams.externalId, association.teamExternalId)).limit(1);
    if (!teamRows[0]) {
      summary.errors.push(`Player ${association.playerExternalId}: team ${association.teamExternalId} hasn't been synced yet.`);
      continue;
    }

    // Players must already exist (run syncPlayers first) — this function never
    // synthesizes a name. A missing player here means the sync order was wrong, not a
    // reason to invent placeholder data.
    const playerRows = await db
      .select()
      .from(schema.players)
      .where(eq(schema.players.externalId, association.playerExternalId))
      .limit(1);
    if (!playerRows[0]) {
      summary.errors.push(
        `Player ${association.playerExternalId} hasn't been synced yet — run syncPlayers for their team first.`,
      );
      continue;
    }
    const player = playerRows[0];

    const existingLineup = await db
      .select()
      .from(schema.gameLineups)
      .where(and(eq(schema.gameLineups.gameId, game.id), eq(schema.gameLineups.playerId, player.id)))
      .limit(1);

    await db
      .insert(schema.gameLineups)
      .values({
        gameId: game.id,
        teamId: teamRows[0].id,
        playerId: player.id,
        position: association.position ?? "Unknown",
        // Never fabricate a starting-lineup signal a provider didn't actually report —
        // null/unknown, not a default true (see nba-espn-provider.ts's doc comment).
        isStarting: association.isStarting ?? null,
        injuryStatus: association.injuryStatus ?? null,
      })
      .onConflictDoUpdate({
        target: [schema.gameLineups.gameId, schema.gameLineups.playerId],
        set: {
          position: association.position ?? "Unknown",
          isStarting: association.isStarting ?? null,
          injuryStatus: association.injuryStatus ?? null,
          teamId: teamRows[0].id,
        },
      });
    if (existingLineup[0]) summary.updated++;
    else summary.inserted++;
  }

  return summary;
}

/**
 * Upserts final player stats for a game. Deliberately only writes rows the provider
 * actually supplied — see the immutability note in docs/stage8: once a selection has been
 * settled away from "pending", getEntryWithResult never re-reads a changed stat for it, so
 * a later correction here won't silently flip an already-settled entry.
 */
export async function syncPlayerGameStats(provider: SportsDataProvider, gameExternalId: string): Promise<SyncSummary> {
  const db = getDb();
  const summary = emptySummary();

  const gameRows = await db.select().from(schema.games).where(eq(schema.games.externalId, gameExternalId)).limit(1);
  const game = gameRows[0];
  if (!game) {
    summary.errors.push(`Game "${gameExternalId}" hasn't been synced yet — run syncGames first.`);
    return summary;
  }

  const stats = await provider.listPlayerGameStats(gameExternalId);
  for (const stat of stats) {
    const check = validatePlayerGameStat(stat);
    if (!check.valid) {
      summary.errors.push(...check.errors);
      continue;
    }

    const [playerRows, teamRows] = await Promise.all([
      db.select().from(schema.players).where(eq(schema.players.externalId, stat.playerExternalId)).limit(1),
      db.select().from(schema.teams).where(eq(schema.teams.externalId, stat.teamExternalId)).limit(1),
    ]);
    if (!playerRows[0] || !teamRows[0]) {
      summary.errors.push(`Stat for player ${stat.playerExternalId}: player or team hasn't been synced yet.`);
      continue;
    }

    const existing = await db
      .select()
      .from(schema.playerGameStats)
      .where(and(eq(schema.playerGameStats.gameId, game.id), eq(schema.playerGameStats.playerId, playerRows[0].id)))
      .limit(1);

    await db
      .insert(schema.playerGameStats)
      .values({
        gameId: game.id,
        playerId: playerRows[0].id,
        teamId: teamRows[0].id,
        tries: stat.statField === "tries" ? stat.statCount : 0,
        goals: stat.statField === "goals" ? stat.statCount : 0,
        points: stat.statField === "points" ? stat.statCount : 0,
      })
      .onConflictDoUpdate({
        target: [schema.playerGameStats.gameId, schema.playerGameStats.playerId],
        set:
          stat.statField === "tries" ? { tries: stat.statCount } : stat.statField === "goals" ? { goals: stat.statCount } : { points: stat.statCount },
      });
    if (existing[0]) {
      summary.updated++;
      // A stat correction after the entries that used it have already been settled can
      // never silently flip an already-settled entry (entrySelections are immutable once
      // non-"pending" — see settle.ts) — but the entry and the "true" stat history now
      // disagree with no admin-visible trace anywhere else in the app. This is the one
      // place that can actually detect it, so make it loud rather than indistinguishable
      // from a normal first-time sync.
      const oldValue = existing[0][stat.statField];
      if (oldValue !== stat.statCount) {
        const competitionRows = await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, game.roundId)).limit(1);
        if (competitionRows[0]?.prizeSettledAt) {
          console.error(
            JSON.stringify({
              event: "stat_corrected_after_settlement",
              gameId: game.id,
              playerId: playerRows[0].id,
              statField: stat.statField,
              oldValue,
              newValue: stat.statCount,
              competitionId: competitionRows[0].id,
              at: new Date().toISOString(),
            }),
          );
        }
      }
    } else {
      summary.inserted++;
    }
  }

  return summary;
}

/**
 * Syncs the actual player eligibility pool (rosters + game-player associations) for a
 * SPECIFIC set of already-synced games, given by their internal DB ids. This is the step
 * a round-schedule sync alone does not cover: syncSeasons/syncTeams/syncGames(ForDateRange)
 * populate the games/teams themselves, but nobody can be selected for them until their
 * player pool is synced too — see src/app/api/admin/rounds/create/route.ts, which calls
 * this immediately after curating a game into a real round (only for the games actually
 * curated, not every candidate in the pool, to avoid unnecessary provider calls).
 */
export async function syncPlayerEligibilityForGames(provider: SportsDataProvider, sportCode: string, gameIds: number[]): Promise<SyncSummary> {
  const db = getDb();
  const summary = emptySummary();
  if (gameIds.length === 0) return summary;

  const gameRows = await db.select().from(schema.games).where(inArray(schema.games.id, gameIds));
  const teamIds = Array.from(new Set(gameRows.flatMap((g) => [g.homeTeamId, g.awayTeamId])));
  const teamRows = teamIds.length ? await db.select().from(schema.teams).where(inArray(schema.teams.id, teamIds)) : [];
  const teamExternalIds = Array.from(new Set(teamRows.map((t) => t.externalId).filter((id): id is string => !!id)));

  // Each team/game is independent — parallelize the real provider calls (roster fetches,
  // game-association fetches) rather than awaiting them one at a time, since a curated
  // round can easily mean a dozen-plus real HTTP round trips otherwise.
  const playerSummaries = await Promise.all(teamExternalIds.map((teamExternalId) => syncPlayers(provider, sportCode, teamExternalId)));
  for (const playerSummary of playerSummaries) {
    summary.inserted += playerSummary.inserted;
    summary.updated += playerSummary.updated;
    summary.errors.push(...playerSummary.errors);
  }

  const gamePlayersSummaries = await Promise.all(
    gameRows.map((game) => (game.externalId ? syncGamePlayers(provider, sportCode, game.externalId) : Promise.resolve({ inserted: 0, updated: 0, errors: [`Game ${game.id} has no provider external ID — cannot sync its player eligibility.`] }))),
  );
  for (const gamePlayersSummary of gamePlayersSummaries) {
    summary.inserted += gamePlayersSummary.inserted;
    summary.updated += gamePlayersSummary.updated;
    summary.errors.push(...gamePlayersSummary.errors);
  }

  return summary;
}
