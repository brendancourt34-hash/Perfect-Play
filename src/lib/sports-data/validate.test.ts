import { describe, expect, it } from "vitest";
import {
  findDuplicateExternalIds,
  findDuplicateGamePlayerAssociations,
  validateGame,
  validateGamePlayerAssociation,
  validatePlayer,
  validatePlayerGameStat,
  validateTeam,
} from "./validate";
import type {
  NormalizedGame,
  NormalizedGamePlayerAssociation,
  NormalizedPlayer,
  NormalizedPlayerGameStat,
  NormalizedTeam,
} from "./types";

const baseGame: NormalizedGame = {
  externalId: "g1",
  roundExternalId: "r1",
  homeTeamExternalId: "t1",
  awayTeamExternalId: "t2",
  status: "scheduled",
};

describe("validateGame", () => {
  it("accepts a game with two distinct teams and a provider ID", () => {
    expect(validateGame(baseGame)).toEqual({ valid: true });
  });

  it("rejects a game missing a provider ID", () => {
    const result = validateGame({ ...baseGame, externalId: "" });
    expect(result.valid).toBe(false);
  });

  it("rejects a game without two teams", () => {
    const result = validateGame({ ...baseGame, awayTeamExternalId: "" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(" ")).toMatch(/two teams/);
  });

  it("rejects a game where home and away are the same team", () => {
    const result = validateGame({ ...baseGame, awayTeamExternalId: baseGame.homeTeamExternalId });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(" ")).toMatch(/same team/);
  });
});

describe("validatePlayer", () => {
  const player: NormalizedPlayer = { externalId: "p1", sportCode: "nrl", firstName: "Jane", lastName: "Doe" };

  it("accepts a player with a provider ID and name", () => {
    expect(validatePlayer(player)).toEqual({ valid: true });
  });

  it("rejects a player missing a provider ID", () => {
    expect(validatePlayer({ ...player, externalId: "" }).valid).toBe(false);
  });

  it("rejects a player missing a name", () => {
    expect(validatePlayer({ ...player, firstName: "" }).valid).toBe(false);
  });
});

describe("validateTeam", () => {
  const team: NormalizedTeam = { externalId: "t1", sportCode: "nrl", name: "Test FC", shortName: "TFC" };

  it("accepts a team with a provider ID and name", () => {
    expect(validateTeam(team)).toEqual({ valid: true });
  });

  it("rejects a team missing a provider ID", () => {
    expect(validateTeam({ ...team, externalId: "" }).valid).toBe(false);
  });
});

describe("validateGamePlayerAssociation", () => {
  const association: NormalizedGamePlayerAssociation = { gameExternalId: "g1", playerExternalId: "p1", teamExternalId: "t1" };

  it("accepts a well-formed association", () => {
    expect(validateGamePlayerAssociation(association)).toEqual({ valid: true });
  });

  it("rejects an association missing a team", () => {
    expect(validateGamePlayerAssociation({ ...association, teamExternalId: "" }).valid).toBe(false);
  });
});

describe("validatePlayerGameStat", () => {
  const stat: NormalizedPlayerGameStat = { gameExternalId: "g1", playerExternalId: "p1", teamExternalId: "t1", statField: "tries", statCount: 2 };

  it("accepts a non-negative stat count", () => {
    expect(validatePlayerGameStat(stat)).toEqual({ valid: true });
    expect(validatePlayerGameStat({ ...stat, statCount: 0 })).toEqual({ valid: true });
  });

  it("rejects a negative or non-finite stat count", () => {
    expect(validatePlayerGameStat({ ...stat, statCount: -1 }).valid).toBe(false);
    expect(validatePlayerGameStat({ ...stat, statCount: NaN }).valid).toBe(false);
  });
});

describe("findDuplicateExternalIds", () => {
  it("detects a provider ID reused across a batch", () => {
    expect(findDuplicateExternalIds([{ externalId: "a" }, { externalId: "b" }, { externalId: "a" }])).toEqual(["a"]);
  });

  it("finds nothing when all IDs are unique", () => {
    expect(findDuplicateExternalIds([{ externalId: "a" }, { externalId: "b" }])).toEqual([]);
  });
});

describe("findDuplicateGamePlayerAssociations", () => {
  it("detects the same player listed twice for the same game", () => {
    const associations: NormalizedGamePlayerAssociation[] = [
      { gameExternalId: "g1", playerExternalId: "p1", teamExternalId: "t1" },
      { gameExternalId: "g1", playerExternalId: "p1", teamExternalId: "t1" },
    ];
    expect(findDuplicateGamePlayerAssociations(associations)).toEqual(["g1:p1"]);
  });

  it("does not flag the same player appearing in two different games", () => {
    const associations: NormalizedGamePlayerAssociation[] = [
      { gameExternalId: "g1", playerExternalId: "p1", teamExternalId: "t1" },
      { gameExternalId: "g2", playerExternalId: "p1", teamExternalId: "t1" },
    ];
    expect(findDuplicateGamePlayerAssociations(associations)).toEqual([]);
  });
});
