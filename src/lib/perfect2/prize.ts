/**
 * Prize-pool allocation — Phase 19. Pure functions only (no I/O), same style as
 * settle.ts. Perfect Play has no ranking: every PERFECT entry is an equal winner, so the
 * only real problem here is splitting an integer number of cents evenly among N winners
 * without losing (or inventing) a single cent, and without floating-point arithmetic.
 *
 * Allocation rule (deterministic, documented per the Phase 19 requirement):
 *   base = floor(poolCents / winnerCount)              — every winner's guaranteed share
 *   remainder = poolCents - base * winnerCount          — the cents left over (0..winnerCount-1)
 *   the `remainder` leftover cents go one each to the winners with the LOWEST entryId,
 *   sorted ascending — arbitrary but deterministic and reproducible, so re-running the
 *   same inputs always produces the same allocation.
 * sum(allocations) always equals poolCents exactly by construction.
 */
export interface PrizeAllocation {
  entryId: number;
  amountCents: number;
}

export function allocatePrizePool(poolCents: number, winnerEntryIds: readonly number[]): PrizeAllocation[] {
  if (poolCents < 0) throw new Error(`Prize pool cannot be negative (got ${poolCents}).`);
  if (winnerEntryIds.length === 0) return [];
  if (!Number.isInteger(poolCents)) throw new Error(`Prize pool must be an integer number of cents (got ${poolCents}).`);

  const sortedIds = [...winnerEntryIds].sort((a, b) => a - b);
  const winnerCount = sortedIds.length;
  const base = Math.floor(poolCents / winnerCount);
  const remainder = poolCents - base * winnerCount;

  return sortedIds.map((entryId, index) => ({
    entryId,
    amountCents: base + (index < remainder ? 1 : 0),
  }));
}

export interface PrizeSettlementOutcome {
  /** prizeAmountCents + rolloverInCents at the moment of settlement. */
  currentPoolCents: number;
  winnerCount: number;
  awardedAmountCents: number;
  /** 0 whenever there's at least one winner; the entire pool when there are none. */
  rolloverOutCents: number;
  allocations: PrizeAllocation[];
}

/**
 * The core settlement decision, per docs/phase19-prize-pool.md: winners split the whole
 * current pool (rollover included) evenly; zero winners means the whole pool rolls over.
 * Invariant enforced by construction: awardedAmountCents + rolloverOutCents === currentPoolCents.
 */
export function settlePrizePool(currentPoolCents: number, winnerEntryIds: readonly number[]): PrizeSettlementOutcome {
  if (currentPoolCents < 0) throw new Error(`Current prize pool cannot be negative (got ${currentPoolCents}).`);

  if (winnerEntryIds.length === 0) {
    return { currentPoolCents, winnerCount: 0, awardedAmountCents: 0, rolloverOutCents: currentPoolCents, allocations: [] };
  }

  const allocations = allocatePrizePool(currentPoolCents, winnerEntryIds);
  const awardedAmountCents = allocations.reduce((sum, a) => sum + a.amountCents, 0);
  return { currentPoolCents, winnerCount: winnerEntryIds.length, awardedAmountCents, rolloverOutCents: 0, allocations };
}
