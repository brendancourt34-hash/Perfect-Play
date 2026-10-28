import { describe, expect, it } from "vitest";
import { getSelectionConfig } from "./registry";
import {
  entryResultValues,
  selectionResultValues,
} from "@/db/schema";

describe("sport separation", () => {
  it("NRL settles on tries, AFL on goals, NBA on points, NFL on touchdowns — independent configs", () => {
    expect(getSelectionConfig("nrl").statField).toBe("tries");
    expect(getSelectionConfig("afl").statField).toBe("goals");
    expect(getSelectionConfig("nba").statField).toBe("points");
    expect(getSelectionConfig("nfl").statField).toBe("touchdowns");
  });

  it("every sport is a distinct config object, never merged", () => {
    expect(getSelectionConfig("nrl")).not.toBe(getSelectionConfig("afl"));
    expect(getSelectionConfig("nba")).not.toBe(getSelectionConfig("nfl"));
    expect(getSelectionConfig("nrl").sportCode).toBe("nrl");
    expect(getSelectionConfig("afl").sportCode).toBe("afl");
    expect(getSelectionConfig("nba").sportCode).toBe("nba");
    expect(getSelectionConfig("nfl").sportCode).toBe("nfl");
  });

  it("throws for an unrecognised sport rather than silently combining competitions", () => {
    expect(() => getSelectionConfig("combined")).toThrow();
  });
});

describe("Phase 23F rules — pick the Perfect Round (1 selection per game)", () => {
  it("every sport requires exactly 1 selection per game", () => {
    expect(getSelectionConfig("nrl").selectionsPerGame).toBe(1);
    expect(getSelectionConfig("afl").selectionsPerGame).toBe(1);
    expect(getSelectionConfig("nba").selectionsPerGame).toBe(1);
    expect(getSelectionConfig("nfl").selectionsPerGame).toBe(1);
  });

  it("NRL/AFL/NFL require >=1 of their stat (a single try/goal/touchdown is enough)", () => {
    expect(getSelectionConfig("nrl").targetThreshold).toBe(1);
    expect(getSelectionConfig("afl").targetThreshold).toBe(1);
    expect(getSelectionConfig("nfl").targetThreshold).toBe(1);
  });

  it("NBA requires 25+ points (Phase 23F raised this from the original Phase 22 value of 20)", () => {
    expect(getSelectionConfig("nba").targetThreshold).toBe(25);
  });
});

describe("no points system", () => {
  it("selection results are the tri-state pending/correct/incorrect plus the admin-only 'void' exception — nothing numeric, nothing auto-computed as void", () => {
    // "void" (Phase 22) is never produced by settlement itself — see settleSelection in
    // src/lib/perfect2/settle.ts — it only exists for an explicit admin resolution of a
    // game/player Perfect Play genuinely cannot settle (cancelled game, player never played).
    expect([...selectionResultValues].sort()).toEqual(["correct", "incorrect", "pending", "void"]);
  });

  it("entry results are exactly the tri-state pending/perfect/not_perfect — nothing numeric", () => {
    expect([...entryResultValues].sort()).toEqual(["not_perfect", "pending", "perfect"]);
  });
});
