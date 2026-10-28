import type {
  NormalizedGame,
  NormalizedGamePlayerAssociation,
  NormalizedPlayer,
  NormalizedPlayerGameStat,
  NormalizedRound,
  NormalizedSeason,
  NormalizedTeam,
} from "./types";

/**
 * The contract every sports-data provider adapter must implement. sync.ts (and anything
 * else in the application) only ever talks to this interface — never to a provider's raw
 * API shape directly. This is what lets Perfect Play add a second provider, or swap Champion
 * Data for an alternative, without touching the database layer or settlement engine.
 *
 * Each method returns already-normalized data (see types.ts). An adapter that can't yet
 * fulfil a method (e.g. because API access hasn't been granted) must throw a clear,
 * descriptive error — never return fabricated or placeholder data.
 */
export interface SportsDataProvider {
  /** A short, stable name for logging/diagnostics, e.g. "champion-data", "mock". */
  readonly name: string;

  listSeasons(sportCode: string): Promise<NormalizedSeason[]>;

  listRounds(seasonExternalId: string): Promise<NormalizedRound[]>;

  listTeams(sportCode: string): Promise<NormalizedTeam[]>;

  /** Full player records (name, team, informational position) for one team's current squad. */
  listPlayers(teamExternalId: string): Promise<NormalizedPlayer[]>;

  listGames(roundExternalId: string): Promise<NormalizedGame[]>;

  /**
   * Optional (Phase 22): for a provider with no upstream "round" concept (e.g. NBA,
   * which the real league schedules nightly with no bye-round structure) — fetches real
   * games across a date range instead. A provider that supports this may make
   * listGames(roundExternalId) throw instead of guessing a round; see
   * src/lib/sports-data/sync.ts's syncGamesForDateRange for the caller side.
   */
  listGamesByDateRange?(startIso: string, endIso: string): Promise<NormalizedGame[]>;

  /** Every player associated with a game — the full eligibility pool, no position filter. */
  listGamePlayers(gameExternalId: string): Promise<NormalizedGamePlayerAssociation[]>;

  /**
   * Final/current stat lines for a game. Should omit a player entirely rather than
   * returning a 0 while the match is still in progress and the stat isn't final yet.
   */
  listPlayerGameStats(gameExternalId: string): Promise<NormalizedPlayerGameStat[]>;
}
