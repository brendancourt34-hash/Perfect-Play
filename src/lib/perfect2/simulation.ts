/**
 * Perfect Rate Simulation — Feature 7. Internal/admin-only modeling tool for testing the
 * MATHEMATICAL behaviour of Perfect Play with no real money and no real customers. This
 * is product/statistics modeling, not betting advice: it never recommends a pick, never
 * shows odds, and is never exposed outside the admin area (see src/app/api/admin/simulation).
 *
 * Model: every simulated customer, independently, for every game in the round, picks a
 * player according to a "favourite weighting" (e.g. 70% of customers pick the single
 * most-backed candidate, 20% pick the second-most-backed, 10% the third) — the exact shape
 * the product spec asks for ("100% #1", "90/8/2", "80/15/5", "70/20/10"). Each ranked
 * candidate has an assumed TRUE probability of actually hitting the sport's required stat
 * (rankSuccessProbabilities) — an explicit, caller-supplied MODELING ASSUMPTION, never
 * real statistics, and never presented to a customer. A customer's entry goes PERFECT only
 * if every one of their `gamesCount` independent picks succeeds.
 *
 * Two outputs are always computed together:
 *  - ANALYTICAL (exact, closed-form): fast, no randomness at all, useful as a sanity check
 *    on the simulation and for instant what-if changes.
 *  - SIMULATED (Monte Carlo, seeded): reproducible via src/lib/perfect2/game-selection.ts's
 *    createSeededRng — same seed + same input always produces the exact same output, so a
 *    reported simulation result can always be re-derived, never a one-off unreproducible
 *    number. Never uses Math.random().
 */
import { createSeededRng } from "./game-selection";

export interface SimulationInput {
  /** Selections in the round — 8 for NRL/NBA/NFL, 9 for AFL. Never hard-coded here; the caller supplies it (see getSelectionConfig / round-shape.ts). */
  gamesCount: number;
  /** Number of simulated customers per simulated round. */
  customerCount: number;
  /** Number of independent simulated rounds to run — more simulations = a tighter Monte Carlo estimate, at the cost of runtime. */
  numberOfSimulations: number;
  /**
   * Percentage (0-100) of customers who pick each ranked candidate, most-backed first —
   * e.g. [70, 20, 10] for the product spec's "70/20/10" preset. Must sum to <= 100; any
   * remainder is the implicit "other" bucket (every less-popular candidate, pooled).
   */
  favoriteWeightsPct: number[];
  /**
   * Assumed TRUE probability (0-1) that each ranked candidate actually hits the required
   * stat, in the same rank order as favoriteWeightsPct, PLUS exactly one trailing entry
   * for the "other" bucket. Length must be favoriteWeightsPct.length + 1. An explicit
   * modeling input, never real statistics and never derived from real player data.
   */
  rankSuccessProbabilities: number[];
  /** A what-if Prize Pool assumption (cents) — purely for projecting payout-per-winner; never a real, live pool. */
  assumedPrizePoolCents: number;
  /** Deterministic seed — the same seed always reproduces the exact same simulated result. */
  seed: string;
}

export interface SimulationValidationError {
  errors: string[];
}

/** Validates input shape before running anything — a malformed model (weights >100%, mismatched array lengths) fails loudly rather than producing a silently-wrong number. */
export function validateSimulationInput(input: SimulationInput): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(input.gamesCount) || input.gamesCount <= 0) errors.push("gamesCount must be a positive integer.");
  if (!Number.isInteger(input.customerCount) || input.customerCount <= 0) errors.push("customerCount must be a positive integer.");
  if (!Number.isInteger(input.numberOfSimulations) || input.numberOfSimulations <= 0) errors.push("numberOfSimulations must be a positive integer.");
  if (input.favoriteWeightsPct.some((w) => w < 0)) errors.push("favoriteWeightsPct values cannot be negative.");
  const weightSum = input.favoriteWeightsPct.reduce((a, b) => a + b, 0);
  if (weightSum > 100) errors.push(`favoriteWeightsPct sums to ${weightSum}%, which exceeds 100%.`);
  if (input.rankSuccessProbabilities.length !== input.favoriteWeightsPct.length + 1) {
    errors.push("rankSuccessProbabilities must have exactly one more entry than favoriteWeightsPct (the trailing 'other' bucket).");
  }
  if (input.rankSuccessProbabilities.some((p) => p < 0 || p > 1)) errors.push("rankSuccessProbabilities values must be between 0 and 1.");
  if (input.assumedPrizePoolCents < 0) errors.push("assumedPrizePoolCents cannot be negative.");
  return errors;
}

/** The single-game success probability for a uniformly-random customer under this model — a weighted mixture across every rank bucket, including "other". Exact, no randomness. */
export function singleGameSuccessProbability(favoriteWeightsPct: readonly number[], rankSuccessProbabilities: readonly number[]): number {
  const otherWeightPct = Math.max(0, 100 - favoriteWeightsPct.reduce((a, b) => a + b, 0));
  const weights = [...favoriteWeightsPct, otherWeightPct];
  return weights.reduce((sum, w, i) => sum + (w / 100) * rankSuccessProbabilities[i], 0);
}

export interface AnalyticalResult {
  /** Exact, closed-form probability a single customer's entry goes PERFECT: q^gamesCount, where q is the single-game success probability. */
  expectedPerfectRate: number;
  /** customerCount * expectedPerfectRate. */
  expectedWinnerCount: number;
  /** (1 - expectedPerfectRate)^customerCount — exact probability that NOT ONE of customerCount independent entries goes PERFECT. */
  probabilityZeroPerfect: number;
  /** assumedPrizePoolCents / expectedWinnerCount when expectedWinnerCount > 0, else null — an approximation (E[pool/N] != pool/E[N]), refined by the simulated figure below. */
  expectedPayoutPerPerfectEntryCents: number | null;
}

export interface CorrectCountBucket {
  correctCount: number;
  /** Share (0-100) of all simulated customer-entries, across every simulation, that landed on exactly this many correct picks. */
  percentage: number;
}

export interface SimulatedResult {
  /** Share (0-100) of all simulated customer-entries, across every simulation, that went PERFECT. */
  simulatedPerfectRatePct: number;
  /** Average number of PERFECT entries per simulated round. */
  simulatedExpectedWinnerCount: number;
  /** Share (0-100) of simulated rounds that had zero PERFECT entries. */
  simulatedProbabilityZeroPerfectPct: number;
  /** Average (assumedPrizePoolCents / winnerCount), taken only over simulated rounds that had at least one winner — null if every simulated round had zero winners. */
  simulatedAveragePayoutPerPerfectEntryCents: number | null;
  correctCountDistribution: CorrectCountBucket[];
}

export interface SimulationResult {
  input: SimulationInput;
  singleGameSuccessProbability: number;
  analytical: AnalyticalResult;
  simulated: SimulatedResult;
}

/**
 * Runs the full Perfect Rate simulation: the exact analytical figures plus a seeded Monte
 * Carlo simulation over `numberOfSimulations` independent simulated rounds of
 * `customerCount` customers each. Deterministic — the same `input` (including `seed`)
 * always produces bit-for-bit the same SimulationResult.
 */
export function runSimulation(input: SimulationInput): SimulationResult {
  const errors = validateSimulationInput(input);
  if (errors.length > 0) throw new Error(`Invalid simulation input: ${errors.join(" ")}`);

  const q = singleGameSuccessProbability(input.favoriteWeightsPct, input.rankSuccessProbabilities);
  const expectedPerfectRate = Math.pow(q, input.gamesCount);
  const expectedWinnerCount = input.customerCount * expectedPerfectRate;
  const probabilityZeroPerfect = Math.pow(1 - expectedPerfectRate, input.customerCount);
  const analytical: AnalyticalResult = {
    expectedPerfectRate,
    expectedWinnerCount,
    probabilityZeroPerfect,
    expectedPayoutPerPerfectEntryCents: expectedWinnerCount > 0 ? input.assumedPrizePoolCents / expectedWinnerCount : null,
  };

  const otherWeightPct = Math.max(0, 100 - input.favoriteWeightsPct.reduce((a, b) => a + b, 0));
  const cumulativeWeights: number[] = [];
  let running = 0;
  for (const w of [...input.favoriteWeightsPct, otherWeightPct]) {
    running += w;
    cumulativeWeights.push(running);
  }

  const rng = createSeededRng(input.seed);
  const histogram = new Array<number>(input.gamesCount + 1).fill(0);
  let totalPerfectEntries = 0;
  let zeroPerfectSimulations = 0;
  let winnerCountSum = 0;
  let payoutSampleSum = 0;
  let payoutSampleCount = 0;

  for (let sim = 0; sim < input.numberOfSimulations; sim++) {
    let winnersThisSim = 0;
    for (let customer = 0; customer < input.customerCount; customer++) {
      let correctCount = 0;
      for (let game = 0; game < input.gamesCount; game++) {
        const rankDraw = rng() * 100;
        let rankIndex = cumulativeWeights.findIndex((threshold) => rankDraw < threshold);
        if (rankIndex === -1) rankIndex = cumulativeWeights.length - 1;
        const successDraw = rng();
        if (successDraw < input.rankSuccessProbabilities[rankIndex]) correctCount++;
      }
      histogram[correctCount]++;
      if (correctCount === input.gamesCount) winnersThisSim++;
    }
    totalPerfectEntries += winnersThisSim;
    winnerCountSum += winnersThisSim;
    if (winnersThisSim === 0) {
      zeroPerfectSimulations++;
    } else {
      payoutSampleSum += input.assumedPrizePoolCents / winnersThisSim;
      payoutSampleCount++;
    }
  }

  const totalCustomerEntries = input.numberOfSimulations * input.customerCount;
  const correctCountDistribution: CorrectCountBucket[] = histogram.map((count, correctCount) => ({
    correctCount,
    percentage: totalCustomerEntries > 0 ? Math.round((count / totalCustomerEntries) * 10000) / 100 : 0,
  }));

  const simulated: SimulatedResult = {
    simulatedPerfectRatePct: totalCustomerEntries > 0 ? Math.round((totalPerfectEntries / totalCustomerEntries) * 10000) / 100 : 0,
    simulatedExpectedWinnerCount: input.numberOfSimulations > 0 ? winnerCountSum / input.numberOfSimulations : 0,
    simulatedProbabilityZeroPerfectPct: input.numberOfSimulations > 0 ? Math.round((zeroPerfectSimulations / input.numberOfSimulations) * 10000) / 100 : 0,
    simulatedAveragePayoutPerPerfectEntryCents: payoutSampleCount > 0 ? Math.round(payoutSampleSum / payoutSampleCount) : null,
    correctCountDistribution,
  };

  return { input, singleGameSuccessProbability: q, analytical, simulated };
}

/** Named customer-selection-model presets from the product spec — NRL example weightings. Reused for any sport; the caller still supplies its own rankSuccessProbabilities. */
export const FAVORITE_WEIGHT_PRESETS: { label: string; favoriteWeightsPct: number[] }[] = [
  { label: "100% pick the #1 favourite", favoriteWeightsPct: [100] },
  { label: "90 / 8 / 2", favoriteWeightsPct: [90, 8, 2] },
  { label: "80 / 15 / 5", favoriteWeightsPct: [80, 15, 5] },
  { label: "70 / 20 / 10", favoriteWeightsPct: [70, 20, 10] },
];
