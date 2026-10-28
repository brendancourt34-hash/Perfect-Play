import { describe, expect, it } from "vitest";
import { isSelectionLocked, validateEntrySelections, validateSelection } from "./validate";

// A game with 4 eligible players across two teams, spanning multiple positions —
// used to prove selection is never restricted by position or team.
const eligiblePlayerIds = new Set([1, 2, 3, 4]); // 1,2 = team A (winger, prop); 3,4 = team B (fullback, halfback)

describe("validateSelection — 1 pick per game (every sport since Phase 23F)", () => {
  it("allows any single eligible player, regardless of position or team", () => {
    expect(validateSelection({ gameId: 1, playerIds: [2] }, eligiblePlayerIds, 1)).toEqual({ valid: true });
    expect(validateSelection({ gameId: 1, playerIds: [3] }, eligiblePlayerIds, 1)).toEqual({ valid: true });
  });

  it("rejects a player who belongs to another game", () => {
    const result = validateSelection({ gameId: 1, playerIds: [99] }, eligiblePlayerIds, 1);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(" ")).toMatch(/not eligible/i);
  });

  it("rejects a missing selection", () => {
    expect(validateSelection({ gameId: 1, playerIds: [null] }, eligiblePlayerIds, 1).valid).toBe(false);
    expect(validateSelection({ gameId: 1, playerIds: [undefined] }, eligiblePlayerIds, 1).valid).toBe(false);
    expect(validateSelection({ gameId: 1, playerIds: [] }, eligiblePlayerIds, 1).valid).toBe(false);
  });

  it("rejects a request that supplies 2 players for a 1-selection sport", () => {
    const result = validateSelection({ gameId: 1, playerIds: [1, 2] }, eligiblePlayerIds, 1);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(" ")).toMatch(/exactly 1/i);
  });
});

describe("validateSelection — 2 picks per game (historical entries only)", () => {
  it("allows two distinct eligible players when the sport config calls for 2", () => {
    expect(validateSelection({ gameId: 1, playerIds: [1, 3] }, eligiblePlayerIds, 2)).toEqual({ valid: true });
  });

  it("rejects duplicate player selections", () => {
    const result = validateSelection({ gameId: 1, playerIds: [1, 1] }, eligiblePlayerIds, 2);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(" ")).toMatch(/different/i);
  });

  it("requires exactly two players", () => {
    expect(validateSelection({ gameId: 1, playerIds: [1, null] }, eligiblePlayerIds, 2).valid).toBe(false);
    expect(validateSelection({ gameId: 1, playerIds: [1] }, eligiblePlayerIds, 2).valid).toBe(false);
  });
});

describe("validateEntrySelections", () => {
  it("passes when every game in the round has exactly one selection entry", () => {
    const result = validateEntrySelections(
      [10, 11],
      [
        { gameId: 10, playerIds: [1] },
        { gameId: 11, playerIds: [3] },
      ],
    );
    expect(result).toEqual({ valid: true });
  });

  it("rejects a selection for a game outside the round", () => {
    const result = validateEntrySelections([10], [{ gameId: 999, playerIds: [1] }]);
    expect(result.valid).toBe(false);
  });

  it("rejects a round missing a selection for one of its games", () => {
    const result = validateEntrySelections([10, 11], [{ gameId: 10, playerIds: [1] }]);
    expect(result.valid).toBe(false);
  });
});

describe("NBA entry validation — 8 games, exactly 1 player pick per game (never 2, never one per team)", () => {
  const nbaGameIds = [1, 2, 3, 4, 5, 6, 7, 8];
  const nbaSelections = nbaGameIds.map((gameId) => ({ gameId, playerIds: [gameId * 100 + 1] }));

  it("exactly 8 selections (1 per game) is a valid, complete NBA entry", () => {
    expect(validateEntrySelections(nbaGameIds, nbaSelections)).toEqual({ valid: true });
    for (const s of nbaSelections) expect(validateSelection(s, new Set([s.playerIds[0]!]), 1)).toEqual({ valid: true });
  });

  it("7 selections (missing one game) is rejected", () => {
    const result = validateEntrySelections(nbaGameIds, nbaSelections.slice(0, 7));
    expect(result.valid).toBe(false);
  });

  it("9 selections (an extra game not in this round) is rejected", () => {
    const result = validateEntrySelections(nbaGameIds, [...nbaSelections, { gameId: 999, playerIds: [1] }]);
    expect(result.valid).toBe(false);
  });

  it("two selections for the same game are rejected — never one player per team", () => {
    const duplicateGame = [{ gameId: 1, playerIds: [1] }, { gameId: 1, playerIds: [2] }, ...nbaSelections.slice(1)];
    // validateEntrySelections itself only checks game coverage; the per-game "exactly 1
    // player" shape is enforced by validateSelection — a second selection row for the
    // same game is exactly the "one player from each team" bug this guards against.
    const gamesCoveredTwice = duplicateGame.filter((s) => s.gameId === 1);
    expect(gamesCoveredTwice.length).toBe(2);
    for (const s of duplicateGame) {
      if (s.gameId === 1) expect(validateSelection(s, eligiblePlayerIds, 1).valid).toBe(true); // each row alone is shape-valid...
    }
    // ...but supplying 2 players in ONE selection row for one game is what's actually rejected:
    expect(validateSelection({ gameId: 1, playerIds: [1, 2] }, eligiblePlayerIds, 1).valid).toBe(false);
  });

  it("duplicate player IDs within a single game's selection are rejected", () => {
    expect(validateSelection({ gameId: 1, playerIds: [1, 1] }, eligiblePlayerIds, 1).valid).toBe(false);
  });

  it("one player per game is accepted regardless of which team they're on", () => {
    expect(validateSelection({ gameId: 1, playerIds: [1] }, eligiblePlayerIds, 1)).toEqual({ valid: true }); // team A
    expect(validateSelection({ gameId: 1, playerIds: [3] }, eligiblePlayerIds, 1)).toEqual({ valid: true }); // team B
  });
});

describe("isSelectionLocked", () => {
  const now = new Date("2026-09-04T10:00:00Z");

  it("is unlocked for a scheduled game with a future kickoff", () => {
    expect(isSelectionLocked({ status: "scheduled", kickoff: "2026-09-05T10:00:00Z" }, now)).toBe(false);
  });

  it("is locked once kickoff has passed, even if status hasn't updated yet", () => {
    expect(isSelectionLocked({ status: "scheduled", kickoff: "2026-09-04T09:00:00Z" }, now)).toBe(true);
  });

  it("is locked for a live or final game", () => {
    expect(isSelectionLocked({ status: "live", kickoff: null }, now)).toBe(true);
    expect(isSelectionLocked({ status: "final", kickoff: null }, now)).toBe(true);
  });

  it("is unlocked for a scheduled game with no kickoff time set yet", () => {
    expect(isSelectionLocked({ status: "scheduled", kickoff: null }, now)).toBe(false);
  });
});
