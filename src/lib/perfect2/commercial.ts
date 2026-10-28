/**
 * Commercial economics modeling layer — Phase 23E. Pure functions only (no I/O), same
 * style as prize.ts (Phase 19). This is deliberately a SEPARATE, PARALLEL concept from the
 * existing prize-pool/rollover architecture in prize.ts and settlement.ts:
 *
 *   - prize.ts's `settlePrizePool`/`allocatePrizePool` split an ALREADY-DETERMINED pool
 *     (competitions.prizeAmountCents + rolloverInCents, admin-configured) evenly among the
 *     round's actual winners once a competition settles. That is the AUTHORITATIVE,
 *     real-money prize pool a winner is actually paid from. Nothing in this file changes
 *     that logic, those fields, or when/how they're written.
 *
 *   - This file instead answers a completely different, commercial-modeling question:
 *     "if we allocated a configurable percentage of the money actually collected from paid
 *     entries (Entry Revenue) to a prize pool, what would that look like?" — a business
 *     demonstration/reporting view for partner discussions, entirely independent of the
 *     real settlement/payout mechanism above. The two numbers may be configured to align
 *     for a demo, but they are never the same computation and must never be conflated.
 *
 * "Commercial Allocation" (Entry Revenue minus the modeled prize allocation) is
 * deliberately NEVER labeled profit/Perfect Play revenue/partner revenue anywhere in this
 * codebase — no commercial or regulatory agreement has been reached with any partner, and
 * this layer must not imply one. See docs/phase23e-commercial-economics.md.
 */

/** Valid range for a prize-pool allocation, in basis points (0 = 0.00%, 10000 = 100.00%). */
export const MIN_PRIZE_POOL_ALLOCATION_BPS = 0;
export const MAX_PRIZE_POOL_ALLOCATION_BPS = 10_000;

export function isValidPrizePoolAllocationBps(bps: number): boolean {
  return Number.isInteger(bps) && bps >= MIN_PRIZE_POOL_ALLOCATION_BPS && bps <= MAX_PRIZE_POOL_ALLOCATION_BPS;
}

export interface CommercialModelResult {
  entryRevenueCents: number;
  prizePoolAllocationBps: number;
  /** floor/round-half-up(entryRevenueCents × prizePoolAllocationBps / 10000) — see roundHalfUpDivide. */
  modeledPrizePoolCents: number;
  /** entryRevenueCents − modeledPrizePoolCents, by construction (never independently rounded, so the two always sum back to entryRevenueCents exactly). */
  commercialAllocationCents: number;
}

/**
 * ROUND HALF UP integer division, computed entirely in BigInt so there is zero
 * floating-point involvement at any step — `numerator / denominator` in plain JS would
 * otherwise silently go through an IEEE-754 double division before any rounding is
 * applied, which is exactly the imprecision this function exists to avoid. Only ever
 * called here with non-negative inputs (validated by the caller).
 */
function roundHalfUpDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / BigInt(2)) / denominator;
}

/**
 * Splits Entry Revenue into a modeled prize-pool allocation and the remaining commercial
 * allocation, using a configurable basis-points percentage. Deterministic and
 * integer-cents-safe: never touches `number` division, only BigInt, so there is no
 * possibility of a fractional-cent or floating-point rounding surprise regardless of the
 * input magnitude. Rounding policy: ROUND HALF UP on the prize-pool share; the commercial
 * allocation is always the exact remainder (entryRevenueCents − modeledPrizePoolCents),
 * never independently rounded, so the two components always sum back to entryRevenueCents
 * exactly with no cent lost or invented — the same invariant prize.ts's allocatePrizePool
 * already guarantees for winner splits.
 */
export function calculateCommercialModel(entryRevenueCents: number, prizePoolAllocationBps: number): CommercialModelResult {
  if (!Number.isInteger(entryRevenueCents) || entryRevenueCents < 0) {
    throw new Error(`entryRevenueCents must be a non-negative integer number of cents (got ${entryRevenueCents}).`);
  }
  if (!isValidPrizePoolAllocationBps(prizePoolAllocationBps)) {
    throw new Error(`prizePoolAllocationBps must be an integer between ${MIN_PRIZE_POOL_ALLOCATION_BPS} and ${MAX_PRIZE_POOL_ALLOCATION_BPS} (got ${prizePoolAllocationBps}).`);
  }

  const numerator = BigInt(entryRevenueCents) * BigInt(prizePoolAllocationBps);
  const modeledPrizePoolCents = Number(roundHalfUpDivide(numerator, BigInt(10_000)));
  const commercialAllocationCents = entryRevenueCents - modeledPrizePoolCents;

  return { entryRevenueCents, prizePoolAllocationBps, modeledPrizePoolCents, commercialAllocationCents };
}

/**
 * Resolves the effective prize-pool allocation percentage for one competition: its own
 * override if an admin has set one (competitions.prizePoolAllocationBps, nullable — null
 * means "inherit"), otherwise the global platform default
 * (platform_settings.prize_pool_allocation_bps, see src/lib/data/platform-settings.ts).
 * This is the "global default + optional per-competition override" architecture requested
 * for future commercial flexibility, without adding a full per-sport or per-round rule
 * engine that nothing currently needs.
 */
export function resolvePrizePoolAllocationBps(competitionOverrideBps: number | null, globalDefaultBps: number): number {
  return competitionOverrideBps ?? globalDefaultBps;
}
