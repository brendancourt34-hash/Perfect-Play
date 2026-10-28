import type { SportsDataProvider } from "../provider";
import type {
  NormalizedGame,
  NormalizedGamePlayerAssociation,
  NormalizedPlayer,
  NormalizedPlayerGameStat,
  NormalizedRound,
  NormalizedSeason,
  NormalizedTeam,
} from "../types";

/**
 * TEST FIXTURE — NOT A REAL PROVIDER.
 *
 * A minimal, clearly-labelled in-memory implementation of SportsDataProvider used only to
 * prove the normalize → sync → settle pipeline works end to end without a real sports-data
 * connection. Never imported by application code (routes, server actions, scripts) — only
 * by tests. The data below is invented for test purposes and must never be written to the
 * application's actual database or shown to a real user.
 *
 * (createLifecycleMockProvider below is the one deliberate, explicitly-labelled exception
 * to "test-only" — see its own doc comment and src/lib/sports-data/registry.ts.)
 */
export function createMockProvider(): SportsDataProvider {
  const season: NormalizedSeason = { externalId: "mock-season-1", sportCode: "nrl", year: 2026, label: "2026" };
  const round: NormalizedRound = { externalId: "mock-round-1", seasonExternalId: season.externalId, roundNumber: 1 };
  const teamA: NormalizedTeam = { externalId: "mock-team-a", sportCode: "nrl", name: "Mock Sharks", shortName: "SHK" };
  const teamB: NormalizedTeam = { externalId: "mock-team-b", sportCode: "nrl", name: "Mock Eels", shortName: "EEL" };
  const game: NormalizedGame = {
    externalId: "mock-game-1",
    roundExternalId: round.externalId,
    homeTeamExternalId: teamA.externalId,
    awayTeamExternalId: teamB.externalId,
    kickoff: "2026-03-01T09:00:00Z",
    status: "final",
    homeScore: 24,
    awayScore: 18,
  };
  const playerRecords: NormalizedPlayer[] = [
    { externalId: "mock-player-1", sportCode: "nrl", firstName: "Mock", lastName: "Winger", position: "Winger", teamExternalId: teamA.externalId },
    { externalId: "mock-player-2", sportCode: "nrl", firstName: "Mock", lastName: "Prop", position: "Prop", teamExternalId: teamA.externalId },
    { externalId: "mock-player-3", sportCode: "nrl", firstName: "Mock", lastName: "Fullback", position: "Fullback", teamExternalId: teamB.externalId },
  ];
  const players: NormalizedGamePlayerAssociation[] = [
    { gameExternalId: game.externalId, playerExternalId: "mock-player-1", teamExternalId: teamA.externalId, position: "Winger" },
    { gameExternalId: game.externalId, playerExternalId: "mock-player-2", teamExternalId: teamA.externalId, position: "Prop" },
    { gameExternalId: game.externalId, playerExternalId: "mock-player-3", teamExternalId: teamB.externalId, position: "Fullback" },
  ];
  const stats: NormalizedPlayerGameStat[] = [
    { gameExternalId: game.externalId, playerExternalId: "mock-player-1", teamExternalId: teamA.externalId, statField: "tries", statCount: 1 },
    { gameExternalId: game.externalId, playerExternalId: "mock-player-2", teamExternalId: teamA.externalId, statField: "tries", statCount: 0 },
    // mock-player-3 deliberately has no stat row — simulates a provider omitting a
    // not-yet-final stat rather than sending a synthetic 0.
  ];

  return {
    name: "mock",
    async listSeasons() {
      return [season];
    },
    async listRounds() {
      return [round];
    },
    async listTeams() {
      return [teamA, teamB];
    },
    async listPlayers(teamExternalId: string) {
      return playerRecords.filter((p) => p.teamExternalId === teamExternalId);
    },
    async listGames() {
      return [game];
    },
    async listGamePlayers() {
      return players;
    },
    async listPlayerGameStats() {
      return stats;
    },
  };
}

/**
 * TEST FIXTURE — NOT A REAL PROVIDER. NFL equivalent of createMockProvider() above (same
 * single-game, minimal shape) — used only when NFL_SPORTS_DATA_PROVIDER=mock is explicitly
 * set (see registry.ts's getNflSportsDataProvider). NFL has no real production provider
 * connected yet (see config.ts), so this exists purely to exercise the sync pipeline with
 * NFL's own sportCode/statField ("touchdowns") for dev/test, never real data.
 */
export function createNflMockProvider(): SportsDataProvider {
  const season: NormalizedSeason = { externalId: "mock-nfl-season-1", sportCode: "nfl", year: 2026, label: "2026" };
  const round: NormalizedRound = { externalId: "mock-nfl-round-1", seasonExternalId: season.externalId, roundNumber: 1 };
  const teamA: NormalizedTeam = { externalId: "mock-nfl-team-a", sportCode: "nfl", name: "Mock Eagles", shortName: "EAG" };
  const teamB: NormalizedTeam = { externalId: "mock-nfl-team-b", sportCode: "nfl", name: "Mock Ravens", shortName: "RAV" };
  const game: NormalizedGame = {
    externalId: "mock-nfl-game-1",
    roundExternalId: round.externalId,
    homeTeamExternalId: teamA.externalId,
    awayTeamExternalId: teamB.externalId,
    kickoff: "2026-09-07T20:00:00Z",
    status: "final",
    homeScore: 27,
    awayScore: 20,
  };
  const playerRecords: NormalizedPlayer[] = [
    { externalId: "mock-nfl-player-1", sportCode: "nfl", firstName: "Mock", lastName: "WideReceiver", position: "WR", teamExternalId: teamA.externalId },
    { externalId: "mock-nfl-player-2", sportCode: "nfl", firstName: "Mock", lastName: "RunningBack", position: "RB", teamExternalId: teamA.externalId },
    { externalId: "mock-nfl-player-3", sportCode: "nfl", firstName: "Mock", lastName: "TightEnd", position: "TE", teamExternalId: teamB.externalId },
  ];
  const players: NormalizedGamePlayerAssociation[] = [
    { gameExternalId: game.externalId, playerExternalId: "mock-nfl-player-1", teamExternalId: teamA.externalId, position: "WR" },
    { gameExternalId: game.externalId, playerExternalId: "mock-nfl-player-2", teamExternalId: teamA.externalId, position: "RB" },
    { gameExternalId: game.externalId, playerExternalId: "mock-nfl-player-3", teamExternalId: teamB.externalId, position: "TE" },
  ];
  const stats: NormalizedPlayerGameStat[] = [
    { gameExternalId: game.externalId, playerExternalId: "mock-nfl-player-1", teamExternalId: teamA.externalId, statField: "touchdowns", statCount: 1 },
    { gameExternalId: game.externalId, playerExternalId: "mock-nfl-player-2", teamExternalId: teamA.externalId, statField: "touchdowns", statCount: 0 },
    // mock-nfl-player-3 deliberately has no stat row — simulates a provider omitting a
    // not-yet-final stat rather than sending a synthetic 0.
  ];

  return {
    name: "mock-nfl",
    async listSeasons() {
      return [season];
    },
    async listRounds() {
      return [round];
    },
    async listTeams() {
      return [teamA, teamB];
    },
    async listPlayers(teamExternalId: string) {
      return playerRecords.filter((p) => p.teamExternalId === teamExternalId);
    },
    async listGames() {
      return [game];
    },
    async listGamePlayers() {
      return players;
    },
    async listPlayerGameStats() {
      return stats;
    },
  };
}

/**
 * TEST FIXTURE — NOT A REAL PROVIDER, AND NEVER REAL DATA, even though — unlike every
 * other provider in this file — it IS reachable from application code: getSportsDataProvider()
 * (src/lib/sports-data/registry.ts) returns this when an operator explicitly sets
 * SPORTS_DATA_PROVIDER=mock, so an admin sync action has something safe and honestly-
 * labelled to exercise the real sync pipeline against without either faking a live
 * Champion Data connection or requiring one to exist yet. It is never selected by
 * default, and its `.name` ("mock-lifecycle") is always visible in sync summaries/logs so
 * nobody mistakes it for a real feed.
 *
 * A richer companion to createMockProvider() (which stays untouched, single-game, for its
 * existing tests) built for Phase 21: exercises the FULL round lifecycle end to end
 * through the real sync pipeline (sync.ts) for BOTH Perfect Play sports at once — multiple
 * games per round with staggered kickoffs (so "first game kickoff" is meaningfully
 * different from "a later game's kickoff"), a mix of game statuses (one already final with
 * real try/goal stats, one live, two still scheduled — so "completed games" and "remaining
 * games" are both represented in a single deterministic snapshot), and a `teamListsReleased`
 * toggle so the same fixture can represent both "games exist but no team list yet" and
 * "team lists released, full selectable player pool available" without maintaining two
 * separate fixtures.
 *
 * Kickoffs are computed relative to `referenceTime` (defaults to `new Date()`) rather than
 * pinned to a fixed calendar date, so the fixture never silently becomes "a round from the
 * past" as real time moves on — callers that need a specific before/after-kickoff instant
 * pass their own `referenceTime` and compare against it.
 */
export interface LifecycleMockProviderOptions {
  /** Anchor instant every game's kickoff is computed relative to. Defaults to now. */
  referenceTime?: Date;
  /** Whether listGamePlayers() returns the full lineup yet. Defaults true ("released"). */
  teamListsReleased?: boolean;
}

function hoursAfter(reference: Date, hours: number): string {
  return new Date(reference.getTime() + hours * 60 * 60 * 1000).toISOString();
}

export function createLifecycleMockProvider(options: LifecycleMockProviderOptions = {}): SportsDataProvider {
  const referenceTime = options.referenceTime ?? new Date();
  const teamListsReleased = options.teamListsReleased ?? true;

  const seasons: NormalizedSeason[] = [
    { externalId: "mock-lc-season-nrl", sportCode: "nrl", year: 2026, label: "2026" },
    { externalId: "mock-lc-season-afl", sportCode: "afl", year: 2026, label: "2026" },
  ];
  const rounds: NormalizedRound[] = [
    { externalId: "mock-lc-round-nrl-1", seasonExternalId: "mock-lc-season-nrl", roundNumber: 1, name: "Round 1" },
    { externalId: "mock-lc-round-afl-1", seasonExternalId: "mock-lc-season-afl", roundNumber: 1, name: "Round 1" },
  ];
  const teams: NormalizedTeam[] = [
    { externalId: "mock-lc-nrl-team-a", sportCode: "nrl", name: "Lifecycle Sharks", shortName: "LSH" },
    { externalId: "mock-lc-nrl-team-b", sportCode: "nrl", name: "Lifecycle Eels", shortName: "LEE" },
    { externalId: "mock-lc-nrl-team-c", sportCode: "nrl", name: "Lifecycle Broncos", shortName: "LBR" },
    { externalId: "mock-lc-nrl-team-d", sportCode: "nrl", name: "Lifecycle Storm", shortName: "LST" },
    { externalId: "mock-lc-afl-team-a", sportCode: "afl", name: "Lifecycle Swans", shortName: "LSW" },
    { externalId: "mock-lc-afl-team-b", sportCode: "afl", name: "Lifecycle Cats", shortName: "LCA" },
    { externalId: "mock-lc-afl-team-c", sportCode: "afl", name: "Lifecycle Pies", shortName: "LPI" },
    { externalId: "mock-lc-afl-team-d", sportCode: "afl", name: "Lifecycle Hawks", shortName: "LHA" },
  ];

  // Games 1-2 are already underway/decided (final + live) by the time this fixture
  // represents; games 3-4 haven't kicked off — one deterministic snapshot showing every
  // stage at once. Kickoffs strictly increase with game order, but nothing downstream may
  // rely on that ordering — only on the kickoff timestamp itself (see
  // computeFirstGameKickoff, src/lib/competitions/lifecycle.ts).
  const nrlGames: NormalizedGame[] = [
    {
      externalId: "mock-lc-nrl-game-1",
      roundExternalId: "mock-lc-round-nrl-1",
      homeTeamExternalId: "mock-lc-nrl-team-a",
      awayTeamExternalId: "mock-lc-nrl-team-b",
      kickoff: hoursAfter(referenceTime, -4),
      status: "final",
      homeScore: 24,
      awayScore: 18,
    },
    {
      externalId: "mock-lc-nrl-game-2",
      roundExternalId: "mock-lc-round-nrl-1",
      homeTeamExternalId: "mock-lc-nrl-team-c",
      awayTeamExternalId: "mock-lc-nrl-team-d",
      kickoff: hoursAfter(referenceTime, -1),
      status: "live",
    },
    {
      externalId: "mock-lc-nrl-game-3",
      roundExternalId: "mock-lc-round-nrl-1",
      homeTeamExternalId: "mock-lc-nrl-team-b",
      awayTeamExternalId: "mock-lc-nrl-team-c",
      kickoff: hoursAfter(referenceTime, 2),
      status: "scheduled",
    },
    {
      externalId: "mock-lc-nrl-game-4",
      roundExternalId: "mock-lc-round-nrl-1",
      homeTeamExternalId: "mock-lc-nrl-team-d",
      awayTeamExternalId: "mock-lc-nrl-team-a",
      kickoff: hoursAfter(referenceTime, 4),
      status: "scheduled",
    },
  ];
  const aflGames: NormalizedGame[] = [
    {
      externalId: "mock-lc-afl-game-1",
      roundExternalId: "mock-lc-round-afl-1",
      homeTeamExternalId: "mock-lc-afl-team-a",
      awayTeamExternalId: "mock-lc-afl-team-b",
      kickoff: hoursAfter(referenceTime, -4),
      status: "final",
      homeScore: 88,
      awayScore: 72,
    },
    {
      externalId: "mock-lc-afl-game-2",
      roundExternalId: "mock-lc-round-afl-1",
      homeTeamExternalId: "mock-lc-afl-team-c",
      awayTeamExternalId: "mock-lc-afl-team-d",
      kickoff: hoursAfter(referenceTime, -1),
      status: "live",
    },
    {
      externalId: "mock-lc-afl-game-3",
      roundExternalId: "mock-lc-round-afl-1",
      homeTeamExternalId: "mock-lc-afl-team-b",
      awayTeamExternalId: "mock-lc-afl-team-c",
      kickoff: hoursAfter(referenceTime, 2),
      status: "scheduled",
    },
    {
      externalId: "mock-lc-afl-game-4",
      roundExternalId: "mock-lc-round-afl-1",
      homeTeamExternalId: "mock-lc-afl-team-d",
      awayTeamExternalId: "mock-lc-afl-team-a",
      kickoff: hoursAfter(referenceTime, 4),
      status: "scheduled",
    },
  ];
  const games = [...nrlGames, ...aflGames];

  // 4 players per game (2 per team) — comfortably enough for the "any 2 players, same or
  // different team" mechanic to be exercised, spanning both sports.
  function makePlayers(sportCode: "nrl" | "afl", gameId: string, homeTeamId: string, awayTeamId: string) {
    return [
      { externalId: `${gameId}-p1`, sportCode, firstName: "Lifecycle", lastName: `${gameId}-Home1`, teamExternalId: homeTeamId, position: sportCode === "nrl" ? "Winger" : "Forward" },
      { externalId: `${gameId}-p2`, sportCode, firstName: "Lifecycle", lastName: `${gameId}-Home2`, teamExternalId: homeTeamId, position: sportCode === "nrl" ? "Fullback" : "Midfielder" },
      { externalId: `${gameId}-p3`, sportCode, firstName: "Lifecycle", lastName: `${gameId}-Away1`, teamExternalId: awayTeamId, position: sportCode === "nrl" ? "Prop" : "Defender" },
      { externalId: `${gameId}-p4`, sportCode, firstName: "Lifecycle", lastName: `${gameId}-Away2`, teamExternalId: awayTeamId, position: sportCode === "nrl" ? "Halfback" : "Ruck" },
    ];
  }

  const playersByGame = new Map<string, NormalizedPlayer[]>();
  for (const g of games) {
    const sportCode = g.externalId.includes("nrl") ? "nrl" : "afl";
    playersByGame.set(g.externalId, makePlayers(sportCode, g.externalId, g.homeTeamExternalId, g.awayTeamExternalId));
  }
  const allPlayers = Array.from(playersByGame.values()).flat();

  const associationsByGame = new Map<string, NormalizedGamePlayerAssociation[]>();
  for (const g of games) {
    const gamePlayers = playersByGame.get(g.externalId)!;
    associationsByGame.set(
      g.externalId,
      gamePlayers.map((p) => ({ gameExternalId: g.externalId, playerExternalId: p.externalId, teamExternalId: p.teamExternalId!, position: p.position, isStarting: true })),
    );
  }

  // Stats only exist for the "final" games — the "live"/"scheduled" games deliberately
  // have none yet, exactly as a real provider wouldn't finalize an in-progress stat line.
  // In each final game: one home player scores, the other 3 do not — proves both the
  // "correct" and "incorrect" paths through settlement (never fantasy-weighted, just >=1).
  const statsByGame = new Map<string, NormalizedPlayerGameStat[]>();
  statsByGame.set("mock-lc-nrl-game-1", [
    { gameExternalId: "mock-lc-nrl-game-1", playerExternalId: "mock-lc-nrl-game-1-p1", teamExternalId: "mock-lc-nrl-team-a", statField: "tries", statCount: 1 },
    { gameExternalId: "mock-lc-nrl-game-1", playerExternalId: "mock-lc-nrl-game-1-p2", teamExternalId: "mock-lc-nrl-team-a", statField: "tries", statCount: 0 },
    { gameExternalId: "mock-lc-nrl-game-1", playerExternalId: "mock-lc-nrl-game-1-p3", teamExternalId: "mock-lc-nrl-team-b", statField: "tries", statCount: 0 },
    { gameExternalId: "mock-lc-nrl-game-1", playerExternalId: "mock-lc-nrl-game-1-p4", teamExternalId: "mock-lc-nrl-team-b", statField: "tries", statCount: 0 },
  ]);
  statsByGame.set("mock-lc-afl-game-1", [
    { gameExternalId: "mock-lc-afl-game-1", playerExternalId: "mock-lc-afl-game-1-p1", teamExternalId: "mock-lc-afl-team-a", statField: "goals", statCount: 1 },
    { gameExternalId: "mock-lc-afl-game-1", playerExternalId: "mock-lc-afl-game-1-p2", teamExternalId: "mock-lc-afl-team-a", statField: "goals", statCount: 0 },
    { gameExternalId: "mock-lc-afl-game-1", playerExternalId: "mock-lc-afl-game-1-p3", teamExternalId: "mock-lc-afl-team-b", statField: "goals", statCount: 0 },
    { gameExternalId: "mock-lc-afl-game-1", playerExternalId: "mock-lc-afl-game-1-p4", teamExternalId: "mock-lc-afl-team-b", statField: "goals", statCount: 0 },
  ]);

  return {
    name: "mock-lifecycle",
    async listSeasons(sportCode: string) {
      return seasons.filter((s) => s.sportCode === sportCode);
    },
    async listRounds(seasonExternalId: string) {
      return rounds.filter((r) => r.seasonExternalId === seasonExternalId);
    },
    async listTeams(sportCode: string) {
      return teams.filter((t) => t.sportCode === sportCode);
    },
    async listPlayers(teamExternalId: string) {
      return allPlayers.filter((p) => p.teamExternalId === teamExternalId);
    },
    async listGames(roundExternalId: string) {
      return games.filter((g) => g.roundExternalId === roundExternalId);
    },
    async listGamePlayers(gameExternalId: string) {
      // The "team lists released" gate — a round with games but no associations yet is
      // exactly the "games exist but selection isn't possible" readiness state.
      if (!teamListsReleased) return [];
      return associationsByGame.get(gameExternalId) ?? [];
    },
    async listPlayerGameStats(gameExternalId: string) {
      return statsByGame.get(gameExternalId) ?? [];
    },
  };
}
