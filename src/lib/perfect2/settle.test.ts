import { describe, expect, it } from "vitest";
import { determineWinners, settleEntry, settleEntrySelections, settleGameSelection, settleSelection } from "./settle";
import type { SelectionSettlementInput } from "./settle";

describe("settleSelection", () => {
  it("is pending while the game is not final, regardless of stat count", () => {
    expect(settleSelection(0, false)).toBe("pending");
    expect(settleSelection(2, false)).toBe("pending");
    expect(settleSelection(null, false)).toBe("pending");
  });

  it("a player scoring at least 1 (try, goal, or touchdown) is correct once the game is final", () => {
    expect(settleSelection(1, true)).toBe("correct");
    expect(settleSelection(3, true)).toBe("correct");
  });

  it("a player scoring 0 is incorrect once the game is final", () => {
    expect(settleSelection(0, true)).toBe("incorrect");
  });

  it("a missing stat row (null/undefined) counts as 0 once the game is final", () => {
    expect(settleSelection(null, true)).toBe("incorrect");
    expect(settleSelection(undefined, true)).toBe("incorrect");
  });

  it("defaults the threshold to 1 (NRL tries / AFL goals / NFL touchdowns) when none is passed — existing call sites are unaffected", () => {
    expect(settleSelection(1, true)).toBe("correct");
    expect(settleSelection(0, true)).toBe("incorrect");
  });

  it("NBA's 25+ points threshold: exactly 25 is correct, 24 is incorrect", () => {
    expect(settleSelection(25, true, 25)).toBe("correct");
    expect(settleSelection(24, true, 25)).toBe("incorrect");
  });

  it("a higher threshold never leaks into a lower-threshold sport's evaluation — each call is independent", () => {
    expect(settleSelection(5, true, 1)).toBe("correct");
    expect(settleSelection(5, true, 25)).toBe("incorrect");
  });
});

describe("settleGameSelection — 1 selection per game (every sport since Phase 23F)", () => {
  it("is perfect when the single selection is correct", () => {
    expect(settleGameSelection(["correct"])).toBe("perfect");
  });

  it("is not_perfect when the single selection is incorrect", () => {
    expect(settleGameSelection(["incorrect"])).toBe("not_perfect");
  });

  it("is pending when the single selection is still pending", () => {
    expect(settleGameSelection(["pending"])).toBe("pending");
  });

  it("an admin-voided single selection never blocks a game from being perfect", () => {
    expect(settleGameSelection(["void"])).toBe("perfect");
  });

  it("an empty selection list settles as pending (never assumed perfect)", () => {
    expect(settleGameSelection([])).toBe("pending");
  });
});

describe("settleGameSelection — 2 selections per game (historical entries only)", () => {
  it("is perfect when both selections are correct", () => {
    expect(settleGameSelection(["correct", "correct"])).toBe("perfect");
  });

  it("is not_perfect when either selection is incorrect", () => {
    expect(settleGameSelection(["correct", "incorrect"])).toBe("not_perfect");
    expect(settleGameSelection(["incorrect", "correct"])).toBe("not_perfect");
    expect(settleGameSelection(["incorrect", "incorrect"])).toBe("not_perfect");
  });

  it("is pending when either selection is still pending and neither is incorrect", () => {
    expect(settleGameSelection(["pending", "correct"])).toBe("pending");
    expect(settleGameSelection(["correct", "pending"])).toBe("pending");
    expect(settleGameSelection(["pending", "pending"])).toBe("pending");
  });

  it("an incorrect selection takes priority over a pending one", () => {
    expect(settleGameSelection(["incorrect", "pending"])).toBe("not_perfect");
    expect(settleGameSelection(["pending", "incorrect"])).toBe("not_perfect");
  });

  it("an admin-voided selection never blocks a game from being perfect — void + correct → perfect", () => {
    expect(settleGameSelection(["void", "correct"])).toBe("perfect");
    expect(settleGameSelection(["correct", "void"])).toBe("perfect");
    expect(settleGameSelection(["void", "void"])).toBe("perfect");
  });

  it("an incorrect selection still fails the game even alongside a void one — void never overrides a real miss", () => {
    expect(settleGameSelection(["void", "incorrect"])).toBe("not_perfect");
    expect(settleGameSelection(["incorrect", "void"])).toBe("not_perfect");
  });

  it("a void selection alongside a still-pending one stays pending, same as correct+pending would", () => {
    expect(settleGameSelection(["void", "pending"])).toBe("pending");
    expect(settleGameSelection(["pending", "void"])).toBe("pending");
  });
});

describe("settleEntry", () => {
  it("is perfect only when every game in the round is perfect", () => {
    expect(settleEntry(["perfect", "perfect", "perfect"])).toBe("perfect");
  });

  it("is not_perfect as soon as any single game fails, even if others are still pending", () => {
    expect(settleEntry(["perfect", "not_perfect", "pending"])).toBe("not_perfect");
  });

  it("is pending when no game has failed but at least one is still undecided", () => {
    expect(settleEntry(["perfect", "pending", "perfect"])).toBe("pending");
  });

  it("is pending when there are no games/selections at all", () => {
    expect(settleEntry([])).toBe("pending");
  });

  it("has no points calculation anywhere — output is always one of the three named results", () => {
    const outcomes = new Set([
      settleEntry(["perfect"]),
      settleEntry(["not_perfect"]),
      settleEntry(["pending"]),
      settleEntry([]),
    ]);
    for (const outcome of outcomes) {
      expect(["pending", "perfect", "not_perfect"]).toContain(outcome);
    }
  });
});

describe("settleEntrySelections — 1 selection per game (whole-entry composition)", () => {
  const finalGames = new Set([1]);
  const isGameFinal = (gameId: number) => finalGames.has(gameId);

  function freshInput(gameId: number, playerId: number): SelectionSettlementInput {
    return { gameId, selections: [{ playerId, storedResult: "pending" }] };
  }

  it("one incorrect game + another pending game → entry NOT PERFECT", () => {
    const stats = new Map([["1:10", 0]]);
    const getStat = (gameId: number, playerId: number) => stats.get(`${gameId}:${playerId}`);
    const result = settleEntrySelections([freshInput(1, 10), freshInput(2, 20)], isGameFinal, getStat);
    expect(result.selections[0].gameResult).toBe("not_perfect");
    expect(result.selections[1].gameResult).toBe("pending");
    expect(result.entryResult).toBe("not_perfect");
  });

  it("all perfect so far + one pending game → entry PENDING", () => {
    const stats = new Map([["1:10", 1]]);
    const getStat = (gameId: number, playerId: number) => stats.get(`${gameId}:${playerId}`);
    const result = settleEntrySelections([freshInput(1, 10), freshInput(2, 20)], isGameFinal, getStat);
    expect(result.selections[0].gameResult).toBe("perfect");
    expect(result.selections[1].gameResult).toBe("pending");
    expect(result.entryResult).toBe("pending");
  });

  it("all games perfect → entry PERFECT", () => {
    const allFinal = (gameId: number) => [1, 2].includes(gameId);
    const stats = new Map([["1:10", 1], ["2:20", 3]]);
    const getStat = (gameId: number, playerId: number) => stats.get(`${gameId}:${playerId}`);
    const result = settleEntrySelections([freshInput(1, 10), freshInput(2, 20)], allFinal, getStat);
    expect(result.entryResult).toBe("perfect");
  });

  it("a selection already settled (correct/incorrect) is never recomputed from live stats", () => {
    const input: SelectionSettlementInput = { gameId: 1, selections: [{ playerId: 10, storedResult: "incorrect" }] };
    // Even though current live stats would now say the player scored (would flip to
    // correct), the stored, already-settled value must win.
    const getStat = () => 5;
    const result = settleEntrySelections([input], isGameFinal, getStat);
    expect(result.selections[0].selections[0].result).toBe("incorrect");
  });

  it("an admin-voided selection is preserved exactly like correct/incorrect — never recomputed", () => {
    const input: SelectionSettlementInput = { gameId: 1, selections: [{ playerId: 10, storedResult: "void" }] };
    const getStat = () => 0; // would settle as incorrect if ever recomputed
    const result = settleEntrySelections([input], isGameFinal, getStat);
    expect(result.selections[0].selections[0].result).toBe("void");
    expect(result.selections[0].gameResult).toBe("perfect");
  });

  it("respects the sport's configured threshold end to end — NBA's 25+ points", () => {
    const stats = new Map([["1:10", 25]]);
    const getStat = (gameId: number, playerId: number) => stats.get(`${gameId}:${playerId}`);
    const result = settleEntrySelections([freshInput(1, 10)], isGameFinal, getStat, 25);
    expect(result.selections[0].selections[0].result).toBe("correct"); // exactly 25
    expect(result.entryResult).toBe("perfect");
  });

  it("a full NBA entry (8 games, 1 pick each, 25+ points) is PERFECT only if all 8 picks score 25+", () => {
    const inputs = Array.from({ length: 8 }, (_, i) => freshInput(i + 1, (i + 1) * 100 + 1));
    const allEightFinal = (gameId: number) => gameId >= 1 && gameId <= 8;
    const allTwentyFive = new Map(inputs.map((inp) => [`${inp.gameId}:${inp.selections[0].playerId}`, 25]));
    const getAllCorrect = (gameId: number, playerId: number) => allTwentyFive.get(`${gameId}:${playerId}`);
    const perfectResult = settleEntrySelections(inputs, allEightFinal, getAllCorrect, 25);
    expect(perfectResult.entryResult).toBe("perfect");
    expect(perfectResult.selections).toHaveLength(8);
    for (const g of perfectResult.selections) expect(g.gameResult).toBe("perfect");
  });

  it("a full NBA entry with exactly one pick scoring 24 (not 25+) is NOT PERFECT — the other 7 correct picks don't save it", () => {
    const inputs = Array.from({ length: 8 }, (_, i) => freshInput(i + 1, (i + 1) * 100 + 1));
    const allEightFinal = (gameId: number) => gameId >= 1 && gameId <= 8;
    const stats = new Map(inputs.map((inp) => [`${inp.gameId}:${inp.selections[0].playerId}`, 25]));
    stats.set(`5:${inputs[4].selections[0].playerId}`, 24); // game 5's pick falls one point short
    const getStat = (gameId: number, playerId: number) => stats.get(`${gameId}:${playerId}`);
    const result = settleEntrySelections(inputs, allEightFinal, getStat, 25);
    expect(result.entryResult).toBe("not_perfect");
    expect(result.selections[4].gameResult).toBe("not_perfect");
    expect(result.selections[4].selections[0].result).toBe("incorrect");
    // every other game is still individually correct — one miss fails the whole entry, but doesn't corrupt the others' own results.
    const otherGames = result.selections.filter((_, i) => i !== 4);
    for (const g of otherGames) expect(g.gameResult).toBe("perfect");
  });

  it("a whole entry with a voided game and every real pick correct is PERFECT, not stuck pending or failed", () => {
    const stats = new Map([["2:20", 1]]);
    const getStat = (gameId: number, playerId: number) => stats.get(`${gameId}:${playerId}`);
    const voidedGame: SelectionSettlementInput = { gameId: 1, selections: [{ playerId: 10, storedResult: "void" }] };
    const allFinal = (gameId: number) => [1, 2].includes(gameId);
    const result = settleEntrySelections([voidedGame, freshInput(2, 20)], allFinal, getStat);
    expect(result.entryResult).toBe("perfect");
  });
});

describe("settleEntrySelections — 2 selections per game (historical entries)", () => {
  const isGameFinal = (gameId: number) => gameId === 1;

  function historicalInput(gameId: number, player1Id: number, player2Id: number): SelectionSettlementInput {
    return {
      gameId,
      selections: [
        { playerId: player1Id, storedResult: "pending" },
        { playerId: player2Id, storedResult: "pending" },
      ],
    };
  }

  it("both selections correct → game PERFECT", () => {
    const stats = new Map([["1:10", 1], ["1:11", 2]]);
    const getStat = (gameId: number, playerId: number) => stats.get(`${gameId}:${playerId}`);
    const result = settleEntrySelections([historicalInput(1, 10, 11)], isGameFinal, getStat);
    expect(result.selections[0].gameResult).toBe("perfect");
    expect(result.selections[0].selections).toHaveLength(2);
  });

  it("one of the two selections incorrect → game NOT PERFECT", () => {
    const stats = new Map([["1:10", 1], ["1:11", 0]]);
    const getStat = (gameId: number, playerId: number) => stats.get(`${gameId}:${playerId}`);
    const result = settleEntrySelections([historicalInput(1, 10, 11)], isGameFinal, getStat);
    expect(result.selections[0].gameResult).toBe("not_perfect");
  });

  it("a historical row's already-stored results are preserved exactly, same immutability rule as the 1-pick path", () => {
    const input: SelectionSettlementInput = {
      gameId: 1,
      selections: [
        { playerId: 10, storedResult: "incorrect" },
        { playerId: 11, storedResult: "correct" },
      ],
    };
    const getStat = () => 5;
    const result = settleEntrySelections([input], isGameFinal, getStat);
    expect(result.selections[0].selections[0].result).toBe("incorrect");
    expect(result.selections[0].selections[1].result).toBe("correct");
  });
});

describe("determineWinners", () => {
  it("zero perfect entries → no winners", () => {
    const result = determineWinners([
      { id: 1, result: "pending" },
      { id: 2, result: "not_perfect" },
    ]);
    expect(result).toEqual({ winnerEntryIds: [], winnerCount: 0 });
  });

  it("one perfect entry → one winner", () => {
    const result = determineWinners([
      { id: 1, result: "perfect" },
      { id: 2, result: "not_perfect" },
    ]);
    expect(result).toEqual({ winnerEntryIds: [1], winnerCount: 1 });
  });

  it("multiple perfect entries → multiple winners, unranked", () => {
    const result = determineWinners([
      { id: 1, result: "perfect" },
      { id: 2, result: "perfect" },
      { id: 3, result: "not_perfect" },
      { id: 4, result: "perfect" },
    ]);
    expect(result.winnerCount).toBe(3);
    expect(new Set(result.winnerEntryIds)).toEqual(new Set([1, 2, 4]));
    // No ranking/ordering guarantee is asserted or implied — order is insertion order only.
  });

  it("no points or scores appear anywhere in the result shape", () => {
    const result = determineWinners([{ id: 1, result: "perfect" }]);
    expect(Object.keys(result).sort()).toEqual(["winnerCount", "winnerEntryIds"]);
  });
});

describe("dynamic round size — the engine never hard-codes a total selection count", () => {
  function allCorrectInput(gameIds: number[]): SelectionSettlementInput[] {
    return gameIds.map((gameId) => ({ gameId, selections: [{ playerId: gameId * 100 + 1, storedResult: "pending" as const }] }));
  }
  const allFinal = () => true;
  const everyoneScores = () => 1;

  it("an 8-game round requires all 8 selections to be correct for PERFECT — derived from the actual games, not a constant", () => {
    const gameIds = [1, 2, 3, 4, 5, 6, 7, 8];
    const result = settleEntrySelections(allCorrectInput(gameIds), allFinal, everyoneScores);
    expect(result.selections).toHaveLength(8);
    expect(result.entryResult).toBe("perfect");
  });

  it("a 9-game round (AFL's Phase 23F shape) settles the same way — same engine, no separate code path", () => {
    const gameIds = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const result = settleEntrySelections(allCorrectInput(gameIds), allFinal, everyoneScores);
    expect(result.selections).toHaveLength(9);
    expect(result.entryResult).toBe("perfect");
  });

  it("a 6-game round (e.g. a State of Origin/bye week) requires all 6 selections — same engine, no separate code path", () => {
    const gameIds = [1, 2, 3, 4, 5, 6];
    const result = settleEntrySelections(allCorrectInput(gameIds), allFinal, everyoneScores);
    expect(result.selections).toHaveLength(6);
    expect(result.entryResult).toBe("perfect");
  });

  it("a 6-game round still fails on a single miss, exactly like an 8-game round does", () => {
    const gameIds = [1, 2, 3, 4, 5, 6];
    const oneMiss = (gameId: number, playerId: number) => (gameId === 3 && playerId === 301 ? 0 : 1);
    const result = settleEntrySelections(allCorrectInput(gameIds), allFinal, oneMiss);
    expect(result.entryResult).toBe("not_perfect");
  });

  it("round size is never assumed to be 8 selections — a 3-game round settles correctly too", () => {
    const gameIds = [1, 2, 3];
    const result = settleEntrySelections(allCorrectInput(gameIds), allFinal, everyoneScores);
    expect(result.selections).toHaveLength(3);
    expect(result.entryResult).toBe("perfect");
  });
});
