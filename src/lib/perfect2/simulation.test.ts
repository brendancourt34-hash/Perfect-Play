import { describe, expect, it } from "vitest";
import { runSimulation, singleGameSuccessProbability, validateSimulationInput, type SimulationInput } from "./simulation";

const BASE: SimulationInput = {
  gamesCount: 8,
  customerCount: 1000,
  numberOfSimulations: 50,
  favoriteWeightsPct: [70, 20, 10],
  rankSuccessProbabilities: [0.4, 0.3, 0.2, 0.1],
  assumedPrizePoolCents: 100_000_00,
  seed: "test-seed-1",
};

describe("validateSimulationInput", () => {
  it("accepts a well-formed input", () => {
    expect(validateSimulationInput(BASE)).toEqual([]);
  });

  it("rejects favoriteWeightsPct summing over 100%", () => {
    const errors = validateSimulationInput({ ...BASE, favoriteWeightsPct: [70, 20, 20] });
    expect(errors.some((e) => e.includes("exceeds 100%"))).toBe(true);
  });

  it("rejects a rankSuccessProbabilities length mismatch", () => {
    const errors = validateSimulationInput({ ...BASE, rankSuccessProbabilities: [0.4, 0.3] });
    expect(errors.some((e) => e.includes("one more entry"))).toBe(true);
  });

  it("rejects a probability outside [0, 1]", () => {
    const errors = validateSimulationInput({ ...BASE, rankSuccessProbabilities: [1.4, 0.3, 0.2, 0.1] });
    expect(errors.some((e) => e.includes("between 0 and 1"))).toBe(true);
  });
});

describe("singleGameSuccessProbability", () => {
  it("is the exact weighted mixture across ranks, including the implicit 'other' bucket", () => {
    // 70% at 0.4, 20% at 0.3, 10% at 0.2, 0% (no remainder) "other" at 0.1
    const q = singleGameSuccessProbability([70, 20, 10], [0.4, 0.3, 0.2, 0.1]);
    expect(q).toBeCloseTo(0.7 * 0.4 + 0.2 * 0.3 + 0.1 * 0.2, 10);
  });

  it("folds any remainder into the 'other' bucket at its own success probability", () => {
    // 50% weight unassigned -> goes to "other" (index 1) at prob 0.05
    const q = singleGameSuccessProbability([50], [0.5, 0.05]);
    expect(q).toBeCloseTo(0.5 * 0.5 + 0.5 * 0.05, 10);
  });
});

describe("runSimulation", () => {
  it("is fully deterministic — the same input (including seed) always reproduces the identical result", () => {
    const a = runSimulation(BASE);
    const b = runSimulation(BASE);
    expect(a).toEqual(b);
  });

  it("a different seed produces a (generally) different simulated result, even with identical model inputs", () => {
    const a = runSimulation(BASE);
    const b = runSimulation({ ...BASE, seed: "a-totally-different-seed" });
    expect(a.simulated).not.toEqual(b.simulated);
    // The analytical (closed-form) figures never depend on the seed at all.
    expect(a.analytical).toEqual(b.analytical);
  });

  it("100% favourite at probability 1.0 always goes PERFECT — exact 100% analytically and empirically", () => {
    const result = runSimulation({
      ...BASE,
      favoriteWeightsPct: [100],
      rankSuccessProbabilities: [1, 0],
      customerCount: 200,
      numberOfSimulations: 5,
    });
    expect(result.analytical.expectedPerfectRate).toBe(1);
    expect(result.analytical.probabilityZeroPerfect).toBe(0);
    expect(result.simulated.simulatedPerfectRatePct).toBe(100);
    expect(result.simulated.correctCountDistribution.find((b) => b.correctCount === result.input.gamesCount)?.percentage).toBe(100);
  });

  it("100% favourite at probability 0 never goes PERFECT", () => {
    const result = runSimulation({ ...BASE, favoriteWeightsPct: [100], rankSuccessProbabilities: [0, 0], customerCount: 200, numberOfSimulations: 5 });
    expect(result.analytical.expectedPerfectRate).toBe(0);
    expect(result.simulated.simulatedPerfectRatePct).toBe(0);
    expect(result.simulated.simulatedAveragePayoutPerPerfectEntryCents).toBeNull();
  });

  it("expectedWinnerCount scales with customerCount at a fixed perfect rate", () => {
    const small = runSimulation({ ...BASE, customerCount: 100 });
    const large = runSimulation({ ...BASE, customerCount: 1000 });
    expect(large.analytical.expectedWinnerCount).toBeCloseTo(small.analytical.expectedWinnerCount * 10, 5);
  });

  it("the correct-count distribution always sums to (approximately) 100% across every bucket", () => {
    const result = runSimulation(BASE);
    const total = result.simulated.correctCountDistribution.reduce((sum, b) => sum + b.percentage, 0);
    expect(total).toBeCloseTo(100, 0);
  });

  it("a higher gamesCount strictly lowers the analytical PERFECT rate when the single-game success probability is below 1", () => {
    const shortRound = runSimulation({ ...BASE, gamesCount: 4 });
    const longRound = runSimulation({ ...BASE, gamesCount: 9 });
    expect(longRound.analytical.expectedPerfectRate).toBeLessThan(shortRound.analytical.expectedPerfectRate);
  });

  it("throws on invalid input rather than silently computing a wrong number", () => {
    expect(() => runSimulation({ ...BASE, favoriteWeightsPct: [70, 50] })).toThrow(/Invalid simulation input/);
  });
});
