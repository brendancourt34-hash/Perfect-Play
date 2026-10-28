import { describe, expect, it } from "vitest";
import { calculateCommercialModel, isValidPrizePoolAllocationBps, resolvePrizePoolAllocationBps } from "./commercial";

describe("calculateCommercialModel", () => {
  it("60% of $5,000 (500000c) = $3,000 prize pool, $2,000 commercial allocation — the worked example from the spec", () => {
    const result = calculateCommercialModel(500_000, 6000);
    expect(result.modeledPrizePoolCents).toBe(300_000);
    expect(result.commercialAllocationCents).toBe(200_000);
  });

  it("100% prize pool: prize = revenue, commercial = 0", () => {
    const result = calculateCommercialModel(500_000, 10_000);
    expect(result.modeledPrizePoolCents).toBe(500_000);
    expect(result.commercialAllocationCents).toBe(0);
  });

  it("0% prize pool: prize = 0, commercial = revenue", () => {
    const result = calculateCommercialModel(500_000, 0);
    expect(result.modeledPrizePoolCents).toBe(0);
    expect(result.commercialAllocationCents).toBe(500_000);
  });

  it("0 revenue: prize = 0, commercial = 0 regardless of percentage", () => {
    expect(calculateCommercialModel(0, 6000)).toMatchObject({ modeledPrizePoolCents: 0, commercialAllocationCents: 0 });
    expect(calculateCommercialModel(0, 10_000)).toMatchObject({ modeledPrizePoolCents: 0, commercialAllocationCents: 0 });
  });

  it("$10.01 (1001c) x 60% rounds deterministically (ROUND HALF UP): 1001*0.6=600.6 -> 601", () => {
    const result = calculateCommercialModel(1001, 6000);
    expect(result.modeledPrizePoolCents).toBe(601);
    expect(result.commercialAllocationCents).toBe(400);
  });

  it("the two components always sum back to entryRevenueCents exactly, never losing or inventing a cent, across many odd amounts", () => {
    for (const cents of [1, 3, 7, 99, 101, 333, 1001, 12345, 999_999, 1_000_001]) {
      for (const bps of [0, 1000, 3333, 5000, 6000, 6667, 9999, 10_000]) {
        const result = calculateCommercialModel(cents, bps);
        expect(result.modeledPrizePoolCents + result.commercialAllocationCents).toBe(cents);
        expect(result.modeledPrizePoolCents).toBeGreaterThanOrEqual(0);
        expect(result.commercialAllocationCents).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("rejects a non-integer or negative entryRevenueCents", () => {
    expect(() => calculateCommercialModel(-1, 6000)).toThrow();
    expect(() => calculateCommercialModel(1.5, 6000)).toThrow();
  });

  it("rejects a prizePoolAllocationBps outside 0-10000, or non-integer", () => {
    expect(() => calculateCommercialModel(500_000, -1)).toThrow();
    expect(() => calculateCommercialModel(500_000, 10_001)).toThrow();
    expect(() => calculateCommercialModel(500_000, 60.5)).toThrow();
  });

  it("never produces a fractional cent — every result is a whole number", () => {
    const result = calculateCommercialModel(1_234_567, 3333);
    expect(Number.isInteger(result.modeledPrizePoolCents)).toBe(true);
    expect(Number.isInteger(result.commercialAllocationCents)).toBe(true);
  });

  it("large revenue amounts stay exact (no floating-point drift) — $1,000,000.00", () => {
    const result = calculateCommercialModel(100_000_000, 6000);
    expect(result.modeledPrizePoolCents).toBe(60_000_000);
    expect(result.commercialAllocationCents).toBe(40_000_000);
  });
});

describe("isValidPrizePoolAllocationBps", () => {
  it("accepts the full 0-10000 integer range", () => {
    expect(isValidPrizePoolAllocationBps(0)).toBe(true);
    expect(isValidPrizePoolAllocationBps(6000)).toBe(true);
    expect(isValidPrizePoolAllocationBps(10_000)).toBe(true);
  });
  it("rejects out-of-range or non-integer values", () => {
    expect(isValidPrizePoolAllocationBps(-1)).toBe(false);
    expect(isValidPrizePoolAllocationBps(10_001)).toBe(false);
    expect(isValidPrizePoolAllocationBps(60.5)).toBe(false);
  });
});

describe("resolvePrizePoolAllocationBps", () => {
  it("uses the competition's own override when set", () => {
    expect(resolvePrizePoolAllocationBps(7500, 6000)).toBe(7500);
  });
  it("falls back to the global default when the competition has no override (null)", () => {
    expect(resolvePrizePoolAllocationBps(null, 6000)).toBe(6000);
  });
  it("a 0 override is respected, not treated as falsy/missing", () => {
    expect(resolvePrizePoolAllocationBps(0, 6000)).toBe(0);
  });
});
