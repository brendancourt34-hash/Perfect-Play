import { describe, expect, it } from "vitest";
import { createLifecycleMockProvider, createMockProvider } from "./mock-provider";
import { settleSelection } from "@/lib/perfect2/settle";
import { validateSelection } from "@/lib/selections/validate";
import { computeFirstGameKickoff } from "@/lib/competitions/lifecycle";

/**
 * These tests prove the normalize → settle/eligibility pipeline works end to end using
 * the clearly-labelled mock provider — NOT real Champion Data. See mock-provider.ts.
 */
describe("mock provider — normalized data shape", () => {
  it("imports a game with both teams correctly associated", async () => {
    const provider = createMockProvider();
    const [game] = await provider.listGames("mock-round-1");
    expect(game.homeTeamExternalId).toBe("mock-team-a");
    expect(game.awayTeamExternalId).toBe("mock-team-b");
    expect(game.homeTeamExternalId).not.toBe(game.awayTeamExternalId);
  });

  it("associates players with the specific game, spanning both teams", async () => {
    const provider = createMockProvider();
    const associations = await provider.listGamePlayers("mock-game-1");
    expect(associations.every((a) => a.gameExternalId === "mock-game-1")).toBe(true);
    const teamIds = new Set(associations.map((a) => a.teamExternalId));
    expect(teamIds).toEqual(new Set(["mock-team-a", "mock-team-b"]));
  });

  it("does not restrict association by position — wingers, props, and fullbacks all appear", async () => {
    const provider = createMockProvider();
    const associations = await provider.listGamePlayers("mock-game-1");
    const positions = associations.map((a) => a.position);
    expect(positions).toContain("Winger");
    expect(positions).toContain("Prop");
    expect(positions).toContain("Fullback");
  });
});

describe("mock provider — NRL settlement (tries)", () => {
  it("stores a try count that settles as CORRECT once the game is final", async () => {
    const provider = createMockProvider();
    const [game] = await provider.listGames("mock-round-1");
    const stats = await provider.listPlayerGameStats("mock-game-1");

    const scorer = stats.find((s) => s.playerExternalId === "mock-player-1")!;
    expect(scorer.statField).toBe("tries");
    expect(scorer.statCount).toBe(1);
    expect(settleSelection(scorer.statCount, game.status === "final")).toBe("correct");
  });

  it("a player with 0 tries settles as INCORRECT once the game is final", async () => {
    const provider = createMockProvider();
    const [game] = await provider.listGames("mock-round-1");
    const stats = await provider.listPlayerGameStats("mock-game-1");

    const nonScorer = stats.find((s) => s.playerExternalId === "mock-player-2")!;
    expect(nonScorer.statCount).toBe(0);
    expect(settleSelection(nonScorer.statCount, game.status === "final")).toBe("incorrect");
  });

  it("a player the provider never sent a stat row for stays PENDING rather than defaulting to incorrect while unfinished", async () => {
    const provider = createMockProvider();
    const stats = await provider.listPlayerGameStats("mock-game-1");
    const missing = stats.find((s) => s.playerExternalId === "mock-player-3");
    expect(missing).toBeUndefined();
    // Simulates the game not yet being final for that player's stat line.
    expect(settleSelection(undefined, false)).toBe("pending");
  });
});

describe("mock provider — eligibility integration", () => {
  // Once synced, each mock-player-N gets some internal DB integer ID; these tests use
  // 1/2/3 to stand in for those (mock-player-1/2/3), matching mock-provider.ts's fixture.
  const eligibleIds = new Set([1, 2, 3]);

  it("any two associated players, same team or different, pass selection validation", async () => {
    const provider = createMockProvider();
    const associations = await provider.listGamePlayers("mock-game-1");
    expect(associations).toHaveLength(3); // sanity check against the fixture shape

    // Same-team pair (player 1 + player 2, both mock-team-a)
    expect(validateSelection({ gameId: 1, playerIds: [1, 2] }, eligibleIds, 2)).toEqual({ valid: true });
    // Cross-team pair (player 1 + player 3)
    expect(validateSelection({ gameId: 1, playerIds: [1, 3] }, eligibleIds, 2)).toEqual({ valid: true });
  });

  it("a player not associated with this game is rejected", () => {
    const result = validateSelection({ gameId: 1, playerIds: [1, 999] }, eligibleIds, 2);
    expect(result.valid).toBe(false);
  });
});

describe("lifecycle mock provider (Phase 21) — covers both sports across the whole round lifecycle", () => {
  const referenceTime = new Date("2026-05-01T00:00:00Z");

  it("supplies both NRL and AFL seasons/rounds/teams independently", async () => {
    const provider = createLifecycleMockProvider({ referenceTime });
    expect(await provider.listSeasons("nrl")).toHaveLength(1);
    expect(await provider.listSeasons("afl")).toHaveLength(1);
    expect(await provider.listTeams("nrl")).toHaveLength(4);
    expect(await provider.listTeams("afl")).toHaveLength(4);
  });

  it("supplies 4 games per sport with strictly increasing kickoffs", async () => {
    const provider = createLifecycleMockProvider({ referenceTime });
    const nrlGames = await provider.listGames("mock-lc-round-nrl-1");
    expect(nrlGames).toHaveLength(4);
    const kickoffs = nrlGames.map((g) => new Date(g.kickoff!).getTime());
    expect(kickoffs).toEqual([...kickoffs].sort((a, b) => a - b));
  });

  it("represents every game-status stage at once: final, live, and scheduled", async () => {
    const provider = createLifecycleMockProvider({ referenceTime });
    const games = await provider.listGames("mock-lc-round-afl-1");
    const statuses = games.map((g) => g.status);
    expect(statuses).toContain("final");
    expect(statuses).toContain("live");
    expect(statuses).toContain("scheduled");
  });

  it("the first game's kickoff is computable and matches the earliest game — the authoritative buy-in cutoff", async () => {
    const provider = createLifecycleMockProvider({ referenceTime });
    const games = await provider.listGames("mock-lc-round-nrl-1");
    const firstKickoff = computeFirstGameKickoff(games.map((g) => ({ kickoff: g.kickoff ? new Date(g.kickoff) : null })));
    expect(firstKickoff?.toISOString()).toBe(games[0].kickoff);
  });

  it("teamListsReleased defaults true — every game has a full selectable player pool", async () => {
    const provider = createLifecycleMockProvider({ referenceTime });
    const associations = await provider.listGamePlayers("mock-lc-nrl-game-3");
    expect(associations.length).toBeGreaterThanOrEqual(2);
    const teamIds = new Set(associations.map((a) => a.teamExternalId));
    expect(teamIds.size).toBe(2); // spans both teams in the game
  });

  it("teamListsReleased: false represents 'games exist but no team list yet' for every game", async () => {
    const provider = createLifecycleMockProvider({ referenceTime, teamListsReleased: false });
    expect(await provider.listGamePlayers("mock-lc-nrl-game-1")).toEqual([]);
    expect(await provider.listGamePlayers("mock-lc-afl-game-3")).toEqual([]);
  });

  it("only the final games have player stats — live/scheduled games correctly have none yet", async () => {
    const provider = createLifecycleMockProvider({ referenceTime });
    expect((await provider.listPlayerGameStats("mock-lc-nrl-game-1")).length).toBeGreaterThan(0);
    expect(await provider.listPlayerGameStats("mock-lc-nrl-game-2")).toEqual([]);
    expect(await provider.listPlayerGameStats("mock-lc-nrl-game-3")).toEqual([]);
  });

  it("NRL stats use tries, AFL stats use goals — never mixed", async () => {
    const provider = createLifecycleMockProvider({ referenceTime });
    const nrlStats = await provider.listPlayerGameStats("mock-lc-nrl-game-1");
    const aflStats = await provider.listPlayerGameStats("mock-lc-afl-game-1");
    expect(nrlStats.every((s) => s.statField === "tries")).toBe(true);
    expect(aflStats.every((s) => s.statField === "goals")).toBe(true);
  });

  it("kickoffs are relative to referenceTime, not a fixed calendar date", async () => {
    const laterReference = new Date(referenceTime.getTime() + 1000 * 60 * 60 * 24 * 30);
    const providerA = createLifecycleMockProvider({ referenceTime });
    const providerB = createLifecycleMockProvider({ referenceTime: laterReference });
    const [gameA] = await providerA.listGames("mock-lc-round-nrl-1");
    const [gameB] = await providerB.listGames("mock-lc-round-nrl-1");
    expect(gameA.kickoff).not.toBe(gameB.kickoff);
  });
});
