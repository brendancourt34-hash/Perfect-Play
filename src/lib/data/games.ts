import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { safeQuery, type DataResult } from "./result";

export type Game = typeof schema.games.$inferSelect;
export type Team = typeof schema.teams.$inferSelect;
export type Player = typeof schema.players.$inferSelect;
export type GameLineupEntry = typeof schema.gameLineups.$inferSelect;
export type PlayerGameStat = typeof schema.playerGameStats.$inferSelect;

export interface GameWithTeams extends Game {
  homeTeam: Team;
  awayTeam: Team;
}

export async function listGamesForRound(roundId: number): Promise<DataResult<GameWithTeams[]>> {
  return safeQuery(async () => {
    const db = getDb();
    const rows = await db.select().from(schema.games).where(eq(schema.games.roundId, roundId));

    const teamIds = Array.from(new Set(rows.flatMap((g) => [g.homeTeamId, g.awayTeamId])));
    const teams = teamIds.length
      ? await db.select().from(schema.teams).where(inArray(schema.teams.id, teamIds))
      : [];
    const teamById = new Map(teams.map((t) => [t.id, t]));

    return rows.map((g) => ({
      ...g,
      homeTeam: teamById.get(g.homeTeamId)!,
      awayTeam: teamById.get(g.awayTeamId)!,
    }));
  });
}

export async function listLineupsForGames(gameIds: number[]): Promise<DataResult<GameLineupEntry[]>> {
  return safeQuery(async () => {
    if (gameIds.length === 0) return [];
    return getDb().select().from(schema.gameLineups).where(inArray(schema.gameLineups.gameId, gameIds));
  });
}

export async function listStatsForGames(gameIds: number[]): Promise<DataResult<PlayerGameStat[]>> {
  return safeQuery(async () => {
    if (gameIds.length === 0) return [];
    return getDb().select().from(schema.playerGameStats).where(inArray(schema.playerGameStats.gameId, gameIds));
  });
}

export interface EligiblePlayer extends Player {
  position: string;
  isStarting: boolean | null;
  teamId: number;
  /** Real provider-reported injury designation (OUT/DOUBTFUL/QUESTIONABLE/DAY_TO_DAY/PROBABLE), or null when none is reported. A row with injuryStatus "OUT" is excluded from this list entirely — see the query below — so any value that DOES appear here is informational only (a picker warning badge), never a reason to exclude. */
  injuryStatus: string | null;
}

/**
 * Every player eligible to be selected for each game in a round — anyone listed in that
 * game's lineup, either team, EXCEPT a player the provider explicitly reports as
 * injury_status = 'OUT'. This is the server-side eligibility boundary: the exclusion
 * happens in the SQL WHERE clause itself, not as a client-side filter after fetching
 * everyone, so an "OUT" player can never be retrieved through this function at all —
 * search or any other UI layered on top of it can't bypass it. Every other status
 * (Doubtful/Questionable/Day-To-Day/Probable/none) remains selectable — see
 * docs on InjuryStatus (src/lib/sports-data/types.ts) for why only OUT is a hard
 * exclusion. No position filtering.
 */
export async function listEligiblePlayersForRound(
  roundId: number,
): Promise<DataResult<Map<number, EligiblePlayer[]>>> {
  return safeQuery(async () => {
    const db = getDb();
    const gamesResult = await listGamesForRound(roundId);
    if (gamesResult.status === "unavailable") throw new Error(gamesResult.message);
    const gameIds = gamesResult.data.map((g) => g.id);

    if (gameIds.length === 0) return new Map();

    const lineups = await db
      .select()
      .from(schema.gameLineups)
      .where(
        and(
          inArray(schema.gameLineups.gameId, gameIds),
          // NULL != 'OUT' evaluates to NULL (falsy) in SQL, which would wrongly exclude
          // every player with no injury designation at all — explicitly keep NULL rows too.
          or(isNull(schema.gameLineups.injuryStatus), ne(schema.gameLineups.injuryStatus, "OUT")),
        ),
      );
    const playerIds = Array.from(new Set(lineups.map((l) => l.playerId)));
    const players = playerIds.length
      ? await db.select().from(schema.players).where(inArray(schema.players.id, playerIds))
      : [];
    const playerById = new Map(players.map((p) => [p.id, p]));

    const byGame = new Map<number, EligiblePlayer[]>();
    for (const lineup of lineups) {
      const player = playerById.get(lineup.playerId);
      if (!player) continue;
      const list = byGame.get(lineup.gameId) ?? [];
      list.push({ ...player, position: lineup.position, isStarting: lineup.isStarting, teamId: lineup.teamId, injuryStatus: lineup.injuryStatus });
      byGame.set(lineup.gameId, list);
    }
    return byGame;
  });
}

export interface GameDetail {
  game: GameWithTeams;
  lineups: GameLineupEntry[];
  stats: PlayerGameStat[];
  players: Player[];
}

export async function getGameDetail(gameId: number): Promise<DataResult<GameDetail | null>> {
  return safeQuery(async () => {
    const db = getDb();
    const rows = await db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
    const game = rows[0];
    if (!game) return null;

    const [homeTeamRows, awayTeamRows, lineups, stats] = await Promise.all([
      db.select().from(schema.teams).where(eq(schema.teams.id, game.homeTeamId)).limit(1),
      db.select().from(schema.teams).where(eq(schema.teams.id, game.awayTeamId)).limit(1),
      db.select().from(schema.gameLineups).where(eq(schema.gameLineups.gameId, gameId)),
      db.select().from(schema.playerGameStats).where(eq(schema.playerGameStats.gameId, gameId)),
    ]);

    const playerIds = Array.from(new Set(lineups.map((l) => l.playerId)));
    const players = playerIds.length
      ? await db.select().from(schema.players).where(inArray(schema.players.id, playerIds))
      : [];

    return {
      game: { ...game, homeTeam: homeTeamRows[0], awayTeam: awayTeamRows[0] },
      lineups,
      stats,
      players,
    };
  });
}
