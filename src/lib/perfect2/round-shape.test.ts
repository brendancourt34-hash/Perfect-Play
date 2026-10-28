import { describe, expect, it } from "vitest";
import { getRoundShapeConfig, validateRoundShape } from "./round-shape";

describe("getRoundShapeConfig", () => {
  it("NRL/AFL/NFL are unconstrained — no fixed game count or day structure, only a UI hint", () => {
    expect(getRoundShapeConfig("nrl")).toEqual({ sportCode: "nrl", gamesPerRound: null, gamesPerDay: null, roundDays: null, recommendedGamesPerRound: 8 });
    // Phase 23F: AFL's recommended shape moved from 8 to 9 games.
    expect(getRoundShapeConfig("afl")).toEqual({ sportCode: "afl", gamesPerRound: null, gamesPerDay: null, roundDays: null, recommendedGamesPerRound: 9 });
    expect(getRoundShapeConfig("nfl")).toEqual({ sportCode: "nfl", gamesPerRound: null, gamesPerDay: null, roundDays: null, recommendedGamesPerRound: 8 });
  });

  it("NBA requires exactly 8 games, 2 per day, across Thursday-Sunday", () => {
    const shape = getRoundShapeConfig("nba");
    expect(shape.gamesPerRound).toBe(8);
    expect(shape.gamesPerDay).toBe(2);
    expect(shape.roundDays).toEqual(["thursday", "friday", "saturday", "sunday"]);
  });

  it("an unrecognized sport is treated as unconstrained rather than throwing", () => {
    expect(getRoundShapeConfig("nhl").gamesPerRound).toBeNull();
  });
});

describe("validateRoundShape", () => {
  const eightGamesTwoPerDay = [
    { slotLabel: "thursday" }, { slotLabel: "thursday" },
    { slotLabel: "friday" }, { slotLabel: "friday" },
    { slotLabel: "saturday" }, { slotLabel: "saturday" },
    { slotLabel: "sunday" }, { slotLabel: "sunday" },
  ];

  it("NRL/AFL always pass, regardless of game count", () => {
    expect(validateRoundShape("nrl", []).valid).toBe(true);
    expect(validateRoundShape("nrl", [{ slotLabel: "monday" }]).valid).toBe(true);
    expect(validateRoundShape("afl", Array(13).fill({ slotLabel: "" })).valid).toBe(true);
  });

  it("NRL: a normal 8-game week passes", () => {
    const eightGames = Array.from({ length: 8 }, () => ({ slotLabel: null }));
    expect(validateRoundShape("nrl", eightGames)).toEqual({ valid: true, errors: [] });
  });

  it("NRL: a 6-game State of Origin/bye week passes just as validly — no 'wrong count' error, no separate Origin mode needed", () => {
    const sixGames = Array.from({ length: 6 }, () => ({ slotLabel: null }));
    expect(validateRoundShape("nrl", sixGames)).toEqual({ valid: true, errors: [] });
  });

  it("AFL: the number of games is likewise never hard-coded", () => {
    expect(validateRoundShape("afl", Array.from({ length: 5 }, () => ({ slotLabel: null }))).valid).toBe(true);
    expect(validateRoundShape("afl", Array.from({ length: 9 }, () => ({ slotLabel: null }))).valid).toBe(true);
  });

  it("NFL: never hard-coded either — an 8-game week and a smaller curated week both pass", () => {
    expect(validateRoundShape("nfl", Array.from({ length: 8 }, () => ({ slotLabel: null }))).valid).toBe(true);
    expect(validateRoundShape("nfl", Array.from({ length: 5 }, () => ({ slotLabel: null }))).valid).toBe(true);
  });

  it("NBA: exactly 8 games, 2 per day across Thu-Sun passes", () => {
    const result = validateRoundShape("nba", eightGamesTwoPerDay);
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("NBA: fewer than 8 games fails with a clear count error", () => {
    const result = validateRoundShape("nba", eightGamesTwoPerDay.slice(0, 7));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("exactly 8"))).toBe(true);
  });

  it("NBA: more than 8 games fails", () => {
    const result = validateRoundShape("nba", [...eightGamesTwoPerDay, { slotLabel: "thursday" }]);
    expect(result.valid).toBe(false);
  });

  it("NBA: an uneven 3/1/2/2 split (still 8 total, same week) PASSES — gamesPerDay is a preference, never a hard per-day floor (the real NBA schedule, e.g. NBA Cup weeks, is often uneven)", () => {
    const skewed = [
      { slotLabel: "thursday" }, { slotLabel: "thursday" }, { slotLabel: "thursday" },
      { slotLabel: "friday" },
      { slotLabel: "saturday" }, { slotLabel: "saturday" },
      { slotLabel: "sunday" }, { slotLabel: "sunday" },
    ];
    expect(validateRoundShape("nba", skewed)).toEqual({ valid: true, errors: [] });
  });

  it("NBA: an invalid day label (e.g. 'monday') is rejected", () => {
    const withBadDay = [...eightGamesTwoPerDay.slice(0, 7), { slotLabel: "monday" }];
    const result = validateRoundShape("nba", withBadDay);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("monday"))).toBe(true);
  });

  describe("NBA: same-week cohesion (root-cause fix — no cross-month/cross-week contamination)", () => {
    const sameWeek = eightGamesTwoPerDay.map((a) => ({ ...a, weekStartDate: "2026-10-15" }));

    it("passes when every game shares the same weekStartDate", () => {
      expect(validateRoundShape("nba", sameWeek)).toEqual({ valid: true, errors: [] });
    });

    it("fails when even one game belongs to a different week (the exact bug being fixed)", () => {
      const contaminated = sameWeek.map((a, i) => (i === 7 ? { ...a, weekStartDate: "2027-03-11" } : a));
      const result = validateRoundShape("nba", contaminated);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("same Thursday-Sunday week"))).toBe(true);
      expect(result.errors.some((e) => e.includes("2026-10-15") && e.includes("2027-03-11"))).toBe(true);
    });

    it("fails when games span three completely different weeks/months", () => {
      const scattered = eightGamesTwoPerDay.map((a, i) => ({
        ...a,
        weekStartDate: i < 3 ? "2026-10-01" : i < 6 ? "2026-11-19" : "2027-03-11",
      }));
      const result = validateRoundShape("nba", scattered);
      expect(result.valid).toBe(false);
    });

    it("is skipped (never fails) when the caller doesn't supply weekStartDate at all — backward compatible with callers that only care about the count/day checks", () => {
      expect(validateRoundShape("nba", eightGamesTwoPerDay)).toEqual({ valid: true, errors: [] });
    });

    it("NRL/AFL/NFL are never subject to the same-week check (no roundDays configured)", () => {
      const scattered = [
        { slotLabel: null, weekStartDate: "2026-10-01" },
        { slotLabel: null, weekStartDate: "2027-03-11" },
      ];
      expect(validateRoundShape("nrl", scattered).valid).toBe(true);
      expect(validateRoundShape("nfl", scattered).valid).toBe(true);
    });
  });
});
