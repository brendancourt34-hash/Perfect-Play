import { describe, expect, it } from "vitest";
import { seededShuffle, selectGamesForShape, type SelectableGame } from "./game-selection";

function flatGames(count: number): SelectableGame[] {
  return Array.from({ length: count }, (_, i) => ({ gameId: i + 1, dayLabel: null }));
}

describe("selectGamesForShape — flat mode (NFL, no day shape)", () => {
  it("14 eligible games -> exactly 8 selected", () => {
    const result = selectGamesForShape(flatGames(14), "seed-a", 8, null);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.selectedGameIds).toHaveLength(8);
  });

  it("exactly 8 eligible games -> all 8 selected", () => {
    const result = selectGamesForShape(flatGames(8), "seed-b", 8, null);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(new Set(result.selectedGameIds)).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8]));
  });

  it("7 eligible games -> fails safely with status 'insufficient', never a short selection", () => {
    const result = selectGamesForShape(flatGames(7), "seed-c", 8, null);
    expect(result.status).toBe("insufficient");
    if (result.status === "insufficient") {
      expect(result.eligibleCount).toBe(7);
      expect(result.required).toBe(8);
    }
  });

  it("zero eligible games -> insufficient, never crashes", () => {
    const result = selectGamesForShape([], "seed-z", 8, null);
    expect(result.status).toBe("insufficient");
  });

  it("never selects the same game twice", () => {
    const result = selectGamesForShape(flatGames(20), "seed-d", 8, null);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(new Set(result.selectedGameIds).size).toBe(8);
  });

  it("every selected game belongs to the eligible pool", () => {
    const eligible = flatGames(15);
    const eligibleIds = new Set(eligible.map((g) => g.gameId));
    const result = selectGamesForShape(eligible, "seed-e", 8, null);
    expect(result.status).toBe("ok");
    if (result.status === "ok") for (const id of result.selectedGameIds) expect(eligibleIds.has(id)).toBe(true);
  });

  it("the same seed and the same eligible input always produce the same selection (deterministic/reproducible)", () => {
    const eligible = flatGames(14);
    const r1 = selectGamesForShape(eligible, "reproducible-seed", 8, null);
    const r2 = selectGamesForShape(eligible, "reproducible-seed", 8, null);
    expect(r1).toEqual(r2);
  });

  it("this holds across many repeated calls, not just two", () => {
    const eligible = flatGames(14);
    const results = Array.from({ length: 10 }, () => selectGamesForShape(eligible, "stable-seed", 8, null));
    for (const r of results) expect(r).toEqual(results[0]);
  });

  it("different seeds can (and typically do) produce different selections from the same pool", () => {
    const eligible = flatGames(14);
    const a = selectGamesForShape(eligible, "seed-one", 8, null);
    const b = selectGamesForShape(eligible, "seed-two", 8, null);
    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    if (a.status === "ok" && b.status === "ok") {
      expect(a.selectedGameIds).not.toEqual(b.selectedGameIds);
    }
  });

  it("is not equivalent to simply taking the first N games in array order (genuinely shuffles, doesn't just slice)", () => {
    const eligible = flatGames(14);
    const naiveFirst8 = eligible.slice(0, 8).map((g) => g.gameId);
    // Try several seeds — at least one must differ from the naive "first 8" to prove real shuffling.
    const seeds = ["s1", "s2", "s3", "s4", "s5"];
    const anyDiffers = seeds.some((seed) => {
      const result = selectGamesForShape(eligible, seed, 8, null);
      return result.status === "ok" && JSON.stringify([...result.selectedGameIds].sort((x, y) => x - y)) !== JSON.stringify([...naiveFirst8].sort((x, y) => x - y));
    });
    expect(anyDiffers).toBe(true);
  });

  it("selection does not depend on the eligible array's input order (same set of games, reordered input, same seed) except via genuine shuffling — the chosen SET is still only ever games actually in the pool", () => {
    const forward = flatGames(10);
    const reversed = [...forward].reverse();
    const rForward = selectGamesForShape(forward, "order-seed", 8, null);
    const rReversed = selectGamesForShape(reversed, "order-seed", 8, null);
    expect(rForward.status).toBe("ok");
    expect(rReversed.status).toBe("ok");
    if (rForward.status === "ok" && rReversed.status === "ok") {
      for (const id of rForward.selectedGameIds) expect([1,2,3,4,5,6,7,8,9,10]).toContain(id);
      for (const id of rReversed.selectedGameIds) expect([1,2,3,4,5,6,7,8,9,10]).toContain(id);
    }
  });

  it("assigns a null slotLabel to every selection in flat mode (no day shape)", () => {
    const result = selectGamesForShape(flatGames(8), "seed-f", 8, null);
    expect(result.status).toBe("ok");
    if (result.status === "ok") for (const a of result.assignments) expect(a.slotLabel).toBeNull();
  });
});

describe("selectGamesForShape — day-bucketed mode (NBA: exactly 2 per day across 4 fixed days)", () => {
  const ROUND_DAYS = ["thursday", "friday", "saturday", "sunday"] as const;
  const dayShape = { gamesPerDay: 2, roundDays: ROUND_DAYS };

  function dayBucketedGames(perDay: number): SelectableGame[] {
    let id = 1;
    const games: SelectableGame[] = [];
    for (const day of ROUND_DAYS) {
      for (let i = 0; i < perDay; i++) games.push({ gameId: id++, dayLabel: day });
    }
    return games;
  }

  it("with exactly 2 eligible games per day, selects all 8 with the correct day slotLabel each", () => {
    const eligible = dayBucketedGames(2);
    const result = selectGamesForShape(eligible, "nba-seed-a", 8, dayShape);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.selectedGameIds).toHaveLength(8);
      const countByDay = new Map<string, number>();
      for (const a of result.assignments) countByDay.set(a.slotLabel!, (countByDay.get(a.slotLabel!) ?? 0) + 1);
      for (const day of ROUND_DAYS) expect(countByDay.get(day)).toBe(2);
    }
  });

  it("with 5 eligible games per day, still selects exactly 2 per day (never more, never fewer)", () => {
    const eligible = dayBucketedGames(5);
    const result = selectGamesForShape(eligible, "nba-seed-b", 8, dayShape);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      const countByDay = new Map<string, number>();
      for (const a of result.assignments) countByDay.set(a.slotLabel!, (countByDay.get(a.slotLabel!) ?? 0) + 1);
      for (const day of ROUND_DAYS) expect(countByDay.get(day)).toBe(2);
    }
  });

  it("if any single day has fewer than 2 eligible games, the whole selection fails as insufficient (never silently short a day)", () => {
    const eligible = dayBucketedGames(2).filter((g) => !(g.dayLabel === "sunday" && g.gameId === 8)); // sunday now has only 1
    const result = selectGamesForShape(eligible, "nba-seed-c", 8, dayShape);
    expect(result.status).toBe("insufficient");
    if (result.status === "insufficient") expect(result.details?.some((d) => d.includes("sunday"))).toBe(true);
  });

  it("a game with a dayLabel outside the required days (e.g. 'monday') is never selected", () => {
    const eligible = [...dayBucketedGames(2), { gameId: 999, dayLabel: "monday" }];
    const result = selectGamesForShape(eligible, "nba-seed-d", 8, dayShape);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.selectedGameIds).not.toContain(999);
  });

  it("same seed -> same day-bucketed selection, reproducibly", () => {
    const eligible = dayBucketedGames(4);
    const r1 = selectGamesForShape(eligible, "nba-stable-seed", 8, dayShape);
    const r2 = selectGamesForShape(eligible, "nba-stable-seed", 8, dayShape);
    expect(r1).toEqual(r2);
  });

  describe("uneven distribution — gamesPerDay is a preference, backfilled from other days when one is short (real NBA Cup weeks etc.)", () => {
    it("a 1/3/2/2 split (exactly 8 total) succeeds and takes every real game — nothing spare to exclude", () => {
      const eligible = [
        { gameId: 1, dayLabel: "thursday" }, // only 1 eligible Thursday game
        { gameId: 2, dayLabel: "friday" },
        { gameId: 3, dayLabel: "friday" },
        { gameId: 4, dayLabel: "friday" },
        { gameId: 5, dayLabel: "saturday" },
        { gameId: 6, dayLabel: "saturday" },
        { gameId: 7, dayLabel: "sunday" },
        { gameId: 8, dayLabel: "sunday" },
      ];
      const result = selectGamesForShape(eligible, "uneven-seed-a", 8, dayShape);
      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        // Exactly 8 total eligible, 8 required -> every single game is selected, uneven split and all.
        expect(new Set(result.selectedGameIds)).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8]));
      }
    });

    it("a genuine surplus (1 Thursday, 4 Friday candidates) backfills the short Thursday and excludes exactly one spare Friday game", () => {
      const eligible = [
        { gameId: 1, dayLabel: "thursday" }, // only 1 eligible Thursday game
        { gameId: 2, dayLabel: "friday" },
        { gameId: 3, dayLabel: "friday" },
        { gameId: 4, dayLabel: "friday" },
        { gameId: 5, dayLabel: "friday" }, // 4 real Friday candidates — one is genuinely spare
        { gameId: 6, dayLabel: "saturday" },
        { gameId: 7, dayLabel: "saturday" },
        { gameId: 8, dayLabel: "sunday" },
        { gameId: 9, dayLabel: "sunday" },
      ];
      const result = selectGamesForShape(eligible, "uneven-seed-a2", 8, dayShape);
      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.selectedGameIds).toHaveLength(8);
        expect(new Set(result.selectedGameIds).size).toBe(8);
        expect(result.selectedGameIds).toContain(1); // Thursday's only game is always taken
        // Exactly one of Friday's 4 candidates is left unselected (the genuine spare).
        const fridayTaken = result.assignments.filter((a) => [2, 3, 4, 5].includes(a.gameId)).length;
        expect(fridayTaken).toBe(3);
      }
    });

    it("a 0/4/2/2 split (one day with ZERO eligible games) still succeeds at 8 total, fully backfilled from the abundant day", () => {
      const eligible = [
        { gameId: 1, dayLabel: "friday" },
        { gameId: 2, dayLabel: "friday" },
        { gameId: 3, dayLabel: "friday" },
        { gameId: 4, dayLabel: "friday" },
        { gameId: 5, dayLabel: "saturday" },
        { gameId: 6, dayLabel: "saturday" },
        { gameId: 7, dayLabel: "sunday" },
        { gameId: 8, dayLabel: "sunday" },
      ]; // zero Thursday games at all
      const result = selectGamesForShape(eligible, "uneven-seed-b", 8, dayShape);
      expect(result.status).toBe("ok");
      if (result.status === "ok") expect(result.selectedGameIds).toHaveLength(8);
    });

    it("total eligible across the whole window below 8 still fails as insufficient, even if some individual days are abundant", () => {
      const eligible = [
        { gameId: 1, dayLabel: "friday" },
        { gameId: 2, dayLabel: "friday" },
        { gameId: 3, dayLabel: "friday" },
        { gameId: 4, dayLabel: "saturday" },
        { gameId: 5, dayLabel: "saturday" },
      ]; // only 5 real games in the whole window
      const result = selectGamesForShape(eligible, "uneven-seed-c", 8, dayShape);
      expect(result.status).toBe("insufficient");
      if (result.status === "insufficient") expect(result.eligibleCount).toBe(5);
    });

    it("an exactly-8 window with perfect 2/2/2/2 availability still selects all 8 (the happy path is unaffected by the backfill logic)", () => {
      const eligible = dayBucketedGames(2);
      const result = selectGamesForShape(eligible, "uneven-seed-d", 8, dayShape);
      expect(result.status).toBe("ok");
      if (result.status === "ok") expect(result.selectedGameIds).toHaveLength(8);
    });

    it("backfilled selections still never include a game from outside the allowed days", () => {
      const eligible = [
        { gameId: 1, dayLabel: "friday" },
        { gameId: 2, dayLabel: "friday" },
        { gameId: 3, dayLabel: "friday" },
        { gameId: 4, dayLabel: "saturday" },
        { gameId: 5, dayLabel: "saturday" },
        { gameId: 6, dayLabel: "sunday" },
        { gameId: 7, dayLabel: "sunday" },
        { gameId: 999, dayLabel: "monday" }, // not a round day — must never be selected, even as backfill
      ];
      const result = selectGamesForShape(eligible, "uneven-seed-e", 8, dayShape);
      // Only 7 real eligible games belong to allowed days (999 doesn't count) -> insufficient, never borrows the Monday game.
      expect(result.status).toBe("insufficient");
    });
  });
});

describe("seededShuffle", () => {
  it("returns a permutation of the input — same elements, no additions or removals", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const shuffled = seededShuffle(items, "perm-seed");
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
  });

  it("never mutates the input array", () => {
    const items = [1, 2, 3, 4, 5];
    const copy = [...items];
    seededShuffle(items, "mutate-check");
    expect(items).toEqual(copy);
  });

  it("is deterministic for a given seed", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(seededShuffle(items, "det-seed")).toEqual(seededShuffle(items, "det-seed"));
  });
});

describe("randomisation quality (sanity, not a mathematical proof)", () => {
  it("over many seeds, every eligible game gets selected a roughly comparable number of times — not systematically favoring array position", () => {
    const eligible = flatGames(10); // pick 8 of 10 many times over
    const counts = new Map<number, number>(eligible.map((g) => [g.gameId, 0]));
    const trials = 300;
    for (let i = 0; i < trials; i++) {
      const result = selectGamesForShape(eligible, `quality-seed-${i}`, 8, null);
      if (result.status === "ok") for (const id of result.selectedGameIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    // Expected selection rate is 8/10 = 80% of trials for every game if unbiased.
    const expected = trials * 0.8;
    for (const [, count] of counts) {
      // Generous tolerance (sanity check, not a statistical proof) — avoids flakiness.
      expect(count).toBeGreaterThan(expected * 0.7);
      expect(count).toBeLessThan(trials);
    }
  });
});
