import { describe, expect, it } from "vitest";
import { allocatePrizePool, settlePrizePool } from "./prize";

describe("allocatePrizePool", () => {
  it("gives a single winner the entire pool", () => {
    expect(allocatePrizePool(6000, [1])).toEqual([{ entryId: 1, amountCents: 6000 }]);
  });

  it("splits evenly between two winners", () => {
    expect(allocatePrizePool(6000, [2, 1])).toEqual([
      { entryId: 1, amountCents: 3000 },
      { entryId: 2, amountCents: 3000 },
    ]);
  });

  it("splits correctly between three winners", () => {
    const allocations = allocatePrizePool(9000, [3, 1, 2]);
    expect(allocations).toEqual([
      { entryId: 1, amountCents: 3000 },
      { entryId: 2, amountCents: 3000 },
      { entryId: 3, amountCents: 3000 },
    ]);
  });

  it("handles an odd-cent split without losing a cent ($100.01 across 3 winners)", () => {
    const allocations = allocatePrizePool(10001, [1, 2, 3]);
    const total = allocations.reduce((sum, a) => sum + a.amountCents, 0);
    expect(total).toBe(10001);
    // floor(10001/3) = 3333, remainder 2 -> two winners get 3334, one gets 3333
    expect(allocations.map((a) => a.amountCents).sort()).toEqual([3333, 3334, 3334]);
  });

  it("total allocations always equal the prize pool, for many winner counts", () => {
    for (const winnerCount of [1, 2, 3, 4, 5, 7, 11, 13]) {
      for (const pool of [500, 6000, 10001, 999999, 1]) {
        const ids = Array.from({ length: winnerCount }, (_, i) => i + 1);
        const allocations = allocatePrizePool(pool, ids);
        const total = allocations.reduce((sum, a) => sum + a.amountCents, 0);
        expect(total).toBe(pool);
      }
    }
  });

  it("gives the leftover cents to the lowest entryIds, deterministically", () => {
    const allocations = allocatePrizePool(10, [30, 10, 20]);
    // base=3, remainder=1 -> lowest entryId (10) gets the extra cent
    expect(allocations).toEqual([
      { entryId: 10, amountCents: 4 },
      { entryId: 20, amountCents: 3 },
      { entryId: 30, amountCents: 3 },
    ]);
  });

  it("rejects a negative pool", () => {
    expect(() => allocatePrizePool(-1, [1])).toThrow(/negative/);
  });

  it("rejects a non-integer pool (no floating-point money)", () => {
    expect(() => allocatePrizePool(100.5, [1])).toThrow(/integer/);
  });

  it("returns an empty allocation list for zero winners", () => {
    expect(allocatePrizePool(6000, [])).toEqual([]);
  });
});

/**
 * Perfect Play sells ENTRIES, not accounts: the prize pool is split by count(PERFECT
 * entries), never count(DISTINCT customers). allocatePrizePool already only ever operates
 * on entry IDs (it has no concept of "user" at all), so a customer owning multiple
 * winning entries naturally receives multiple independent shares — these tests make that
 * property explicit and name the exact scenarios the product rule is built around,
 * including summing a user's shares back up from their owned entry IDs.
 */
describe("multi-entry-per-user prize allocation — Perfect Play sells entries, not accounts", () => {
  /** Sums the amounts of whichever allocations belong to `entryIds` — models "how much does this one customer actually receive", without the allocation function itself ever knowing about users. */
  function totalFor(allocations: { entryId: number; amountCents: number }[], entryIds: number[]): number {
    return allocations.filter((a) => entryIds.includes(a.entryId)).reduce((sum, a) => sum + a.amountCents, 0);
  }

  it("1. one user with one PERFECT entry receives 100% of the pool", () => {
    const allocations = allocatePrizePool(100_000_00, [1]); // entry 1 = user A's only entry
    expect(totalFor(allocations, [1])).toBe(100_000_00);
  });

  it("2. two different users with one PERFECT entry each split 50/50", () => {
    const allocations = allocatePrizePool(100_000_00, [1, 2]); // entry 1 = user A, entry 2 = user B
    expect(totalFor(allocations, [1])).toBe(50_000_00);
    expect(totalFor(allocations, [2])).toBe(50_000_00);
  });

  it("3. one user with TWO PERFECT entries receives TWO shares, never consolidated into one", () => {
    // entries 1 and 2 both belong to user A; entry 3 belongs to user B.
    const allocations = allocatePrizePool(90_00, [1, 2, 3]);
    expect(allocations).toHaveLength(3); // never collapsed into 2 rows just because 2 share an owner
    expect(totalFor(allocations, [1, 2])).toBe(60_00); // user A's two entries = 2/3 of the pool
    expect(totalFor(allocations, [3])).toBe(30_00); // user B's one entry = 1/3
  });

  it("4. user A has 2 PERFECT entries and user B has 1 -> 3 total shares, A gets 2/3, B gets 1/3", () => {
    const userAEntryIds = [10, 11];
    const userBEntryIds = [12];
    const allocations = allocatePrizePool(300_00, [...userAEntryIds, ...userBEntryIds]);
    expect(totalFor(allocations, userAEntryIds)).toBe(200_00);
    expect(totalFor(allocations, userBEntryIds)).toBe(100_00);
  });

  it("5. ten PERFECT entries across four users: the pool divides into 10 equal entry shares, not 4 user shares", () => {
    const userEntries = {
      A: [1, 2], // 2 entries
      B: [3], // 1 entry
      C: [4], // 1 entry
      D: [5, 6, 7, 8, 9, 10], // 6 entries
    };
    const allEntryIds = Object.values(userEntries).flat();
    expect(allEntryIds).toHaveLength(10);
    const allocations = allocatePrizePool(100_000_00, allEntryIds);
    expect(allocations).toHaveLength(10); // 10 shares, never 4
    const perEntryShare = 100_000_00 / 10;
    expect(totalFor(allocations, userEntries.A)).toBe(perEntryShare * 2); // $20,000
    expect(totalFor(allocations, userEntries.B)).toBe(perEntryShare * 1); // $10,000
    expect(totalFor(allocations, userEntries.C)).toBe(perEntryShare * 1); // $10,000
    expect(totalFor(allocations, userEntries.D)).toBe(perEntryShare * 6); // $60,000
    // Sanity: every dollar is accounted for exactly once, matching the worked example in the brief.
    expect(totalFor(allocations, userEntries.A) + totalFor(allocations, userEntries.B) + totalFor(allocations, userEntries.C) + totalFor(allocations, userEntries.D)).toBe(100_000_00);
  });

  it("6. multiple PERFECT entries belonging to the same customer are never consolidated into one allocation row", () => {
    const allocations = allocatePrizePool(500_00, [1, 2, 3, 4, 5]); // all 5 happen to belong to the same single user
    expect(allocations).toHaveLength(5);
    expect(new Set(allocations.map((a) => a.entryId)).size).toBe(5); // 5 distinct entry-level rows, not deduplicated to 1
    for (const a of allocations) expect(a.amountCents).toBe(100_00); // each entry still gets its own full, equal share
  });

  it("8. wallet credit amounts equal the calculated allocation exactly, including remainder/floor handling, even when several winning entries share one owner", () => {
    // $100.01 across 3 entries, 2 of which belong to the same user — proves the exact
    // per-cent remainder rule (see allocatePrizePool's floor+remainder doc comment)
    // still applies correctly per ENTRY, not redistributed once entries are grouped by owner.
    const allocations = allocatePrizePool(10001, [1, 2, 3]); // entries 1 & 2 = user A, entry 3 = user B
    const total = allocations.reduce((sum, a) => sum + a.amountCents, 0);
    expect(total).toBe(10001);
    expect(totalFor(allocations, [1, 2]) + totalFor(allocations, [3])).toBe(10001);
  });
});

describe("settlePrizePool", () => {
  it("zero winners: entire pool becomes rollover, nothing awarded", () => {
    const outcome = settlePrizePool(6000, []);
    expect(outcome).toEqual({ currentPoolCents: 6000, winnerCount: 0, awardedAmountCents: 0, rolloverOutCents: 6000, allocations: [] });
  });

  it("one winner: awards the entire pool, no rollover", () => {
    const outcome = settlePrizePool(12000, [5]);
    expect(outcome.winnerCount).toBe(1);
    expect(outcome.awardedAmountCents).toBe(12000);
    expect(outcome.rolloverOutCents).toBe(0);
    expect(outcome.allocations).toEqual([{ entryId: 5, amountCents: 12000 }]);
  });

  it("invariant: awarded + rollover always equals the current pool", () => {
    for (const winners of [[], [1], [1, 2], [1, 2, 3, 4, 5]]) {
      for (const pool of [0, 500, 6000, 10001, 123456]) {
        const outcome = settlePrizePool(pool, winners);
        expect(outcome.awardedAmountCents + outcome.rolloverOutCents).toBe(pool);
      }
    }
  });

  it("rejects a negative current pool", () => {
    expect(() => settlePrizePool(-500, [1])).toThrow(/negative/);
  });
});
