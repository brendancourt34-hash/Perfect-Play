import type { GameStatus } from "@/db/schema";
import { computeFirstGameKickoff } from "@/lib/competitions/lifecycle";
import { listGamesForRound, listLineupsForGames, listStatsForGames, type GameWithTeams } from "@/lib/data/games";
import { safeQuery, type DataResult } from "@/lib/data/result";

/**
 * Round-readiness reporting for the admin dashboard. Two DISTINCT questions live in this
 * file, both read-only against the same tables the sync pipeline and settlement engine
 * already use (games, game_lineups, player_game_stats) — this never invents data and
 * never decides a result:
 *
 *  1. Settlement readiness (Phase 18, `ready`/`gamesReady`/`hasStatsIfFinal`) — is there
 *     enough real data to settle a round HONESTLY once it's over. Unchanged by Phase 21.
 *  2. Team-list / selection readiness (Phase 21, `teamListsReady`/`blockers`) — is there
 *     enough real data to let a customer actually SELECT players for a round BEFORE it's
 *     played. This is a different question asked at a different point in the lifecycle
 *     (team lists released → competition can open, long before any game is final), so it
 *     gets its own additive fields rather than overloading the settlement ones.
 *
 * Neither concept restricts WHICH players are selectable — a player only needs to be
 * associated with the game at all (see game_lineups / listLineupsForGames); position and
 * starting status are never an eligibility filter.
 */
export type ReadinessBlockerCode =
  | "NO_GAMES"
  | "MISSING_KICKOFF"
  | "MISSING_HOME_TEAM"
  | "MISSING_AWAY_TEAM"
  | "MISSING_PLAYERS"
  | "INCOMPLETE_GAME_PLAYER_DATA";

export interface GameReadiness {
  gameId: number;
  homeTeamName: string;
  awayTeamName: string;
  status: GameStatus;
  hasLineups: boolean;
  /** Only meaningful once the game is final — a final game with no stats can't be settled correctly. */
  hasStatsIfFinal: boolean;
  ready: boolean;
  issues: string[];
  /** Phase 21: does this specific game have everything needed for customer selection yet? */
  hasKickoff: boolean;
  teamListReady: boolean;
  blockers: ReadinessBlockerCode[];
}

export interface RoundReadiness {
  roundId: number;
  gamesTotal: number;
  gamesReady: number;
  ready: boolean;
  games: GameReadiness[];
  issues: string[];
  /** Phase 21: true once every game in the round has a known kickoff AND a released team list (at least one associated player each). */
  teamListsReady: boolean;
  /** Distinct reason codes explaining why teamListsReady is false — empty once it's true. */
  blockers: ReadinessBlockerCode[];
  /** The round's authoritative buy-in cutoff / prize-pool-reveal instant — null until every game has a known kickoff... actually null until AT LEAST one game has a known kickoff (see computeFirstGameKickoff). */
  firstGameKickoffAt: Date | null;
}

export async function getRoundReadiness(roundId: number): Promise<DataResult<RoundReadiness>> {
  return safeQuery(async () => {
    const gamesResult = await listGamesForRound(roundId);
    if (gamesResult.status === "unavailable") throw new Error(gamesResult.message);
    const games = gamesResult.data;

    if (games.length === 0) {
      return {
        roundId,
        gamesTotal: 0,
        gamesReady: 0,
        ready: false,
        games: [],
        issues: ["No games have been scheduled for this round yet."],
        teamListsReady: false,
        blockers: ["NO_GAMES"],
        firstGameKickoffAt: null,
      };
    }

    const gameIds = games.map((g) => g.id);
    const [lineupsResult, statsResult] = await Promise.all([listLineupsForGames(gameIds), listStatsForGames(gameIds)]);
    if (lineupsResult.status === "unavailable") throw new Error(lineupsResult.message);
    if (statsResult.status === "unavailable") throw new Error(statsResult.message);

    const lineupCountByGame = new Map<number, number>();
    for (const l of lineupsResult.data) lineupCountByGame.set(l.gameId, (lineupCountByGame.get(l.gameId) ?? 0) + 1);
    const statCountByGame = new Map<number, number>();
    for (const s of statsResult.data) statCountByGame.set(s.gameId, (statCountByGame.get(s.gameId) ?? 0) + 1);

    const gameReadiness: GameReadiness[] = games.map((g: GameWithTeams) => {
      const issues: string[] = [];
      const hasLineups = (lineupCountByGame.get(g.id) ?? 0) > 0;
      if (!hasLineups) issues.push("Missing lineup data (no players associated with this game).");

      const hasStatsIfFinal = g.status !== "final" || (statCountByGame.get(g.id) ?? 0) > 0;
      if (g.status === "final" && !hasStatsIfFinal) issues.push("Game is final but no player stats have been synced yet.");

      // Team-list / selection readiness — a distinct, earlier-lifecycle question from the
      // settlement readiness above. `homeTeam`/`awayTeam` are guaranteed present by the
      // schema's NOT NULL foreign keys (a game can't be synced without both teams already
      // existing — see syncGames in sports-data/sync.ts), so MISSING_HOME_TEAM/
      // MISSING_AWAY_TEAM are included for completeness but cannot actually occur through
      // the normal sync path; they're still checked defensively rather than assumed.
      const blockers: ReadinessBlockerCode[] = [];
      const hasKickoff = g.kickoff !== null;
      if (!hasKickoff) blockers.push("MISSING_KICKOFF");
      if (!g.homeTeam) blockers.push("MISSING_HOME_TEAM");
      if (!g.awayTeam) blockers.push("MISSING_AWAY_TEAM");
      if (!hasLineups) blockers.push("MISSING_PLAYERS");
      else if ((lineupCountByGame.get(g.id) ?? 0) < 2) blockers.push("INCOMPLETE_GAME_PLAYER_DATA");

      return {
        gameId: g.id,
        homeTeamName: g.homeTeam.name,
        awayTeamName: g.awayTeam.name,
        status: g.status,
        hasLineups,
        hasStatsIfFinal,
        ready: hasLineups && hasStatsIfFinal,
        issues,
        hasKickoff,
        teamListReady: blockers.length === 0,
        blockers,
      };
    });

    const gamesReady = gameReadiness.filter((g) => g.ready).length;
    const roundIssues: string[] = [];
    for (const g of gameReadiness) {
      for (const issue of g.issues) roundIssues.push(`${g.homeTeamName} vs ${g.awayTeamName}: ${issue}`);
    }

    const roundBlockers = Array.from(new Set(gameReadiness.flatMap((g) => g.blockers)));

    return {
      roundId,
      gamesTotal: games.length,
      gamesReady,
      ready: gamesReady === games.length,
      games: gameReadiness,
      issues: roundIssues,
      teamListsReady: roundBlockers.length === 0,
      blockers: roundBlockers,
      firstGameKickoffAt: computeFirstGameKickoff(games),
    };
  });
}
