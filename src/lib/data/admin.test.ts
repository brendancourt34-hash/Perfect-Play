import { describe, expect, it } from "vitest";
import { applyCommercialModel, summarizeEntriesBySport, summarizeSportAnalytics } from "./admin";

const REGISTRY = {
  nrl: { code: "nrl", name: "NRL" },
  afl: { code: "afl", name: "AFL" },
  nba: { code: "nba", name: "NBA" },
};

const SPORTS = [
  { id: 1, code: "nrl" },
  { id: 2, code: "afl" },
  { id: 3, code: "nba" },
];

const COMPETITIONS = [
  { id: 100, sportId: 1 }, // nrl
  { id: 200, sportId: 2 }, // afl
  { id: 300, sportId: 3 }, // nba
];

describe("summarizeEntriesBySport", () => {
  it("NBA appears with zero entries and zero value even when nothing has ever been entered", () => {
    const result = summarizeEntriesBySport([], COMPETITIONS, SPORTS, REGISTRY);
    const nba = result.bySport.find((s) => s.sportCode === "nba");
    expect(nba).toEqual({ sportCode: "nba", sportName: "NBA", entryCount: 0, totalEntryValueCents: 0 });
    expect(result.total).toBe(0);
    expect(result.totalEntryValueCents).toBe(0);
  });

  it("every registered sport (NRL, AFL, NBA) always gets exactly one row, in registry order, never omitted", () => {
    const result = summarizeEntriesBySport([], COMPETITIONS, SPORTS, REGISTRY);
    expect(result.bySport.map((s) => s.sportCode)).toEqual(["nrl", "afl", "nba"]);
  });

  it("counts and sums paid entries correctly per sport, matching the worked example from the spec", () => {
    const entries = [
      ...Array.from({ length: 125 }, () => ({ competitionId: 100, paidAmountCents: 500 })), // nrl: 125 x $5 = $625
      ...Array.from({ length: 98 }, () => ({ competitionId: 200, paidAmountCents: 500 })), // afl: 98 x $5 = $490
      ...Array.from({ length: 76 }, () => ({ competitionId: 300, paidAmountCents: 500 })), // nba: 76 x $5 = $380
    ];
    const result = summarizeEntriesBySport(entries, COMPETITIONS, SPORTS, REGISTRY);
    expect(result.bySport.find((s) => s.sportCode === "nrl")).toEqual({ sportCode: "nrl", sportName: "NRL", entryCount: 125, totalEntryValueCents: 62_500 });
    expect(result.bySport.find((s) => s.sportCode === "afl")).toEqual({ sportCode: "afl", sportName: "AFL", entryCount: 98, totalEntryValueCents: 49_000 });
    expect(result.bySport.find((s) => s.sportCode === "nba")).toEqual({ sportCode: "nba", sportName: "NBA", entryCount: 76, totalEntryValueCents: 38_000 });
    expect(result.total).toBe(299);
    expect(result.totalEntryValueCents).toBe(149_500); // matches the spec's $1,495.00 TOTAL example exactly
  });

  it("NBA entries are never merged into NRL or AFL, and vice versa — sports stay strictly separated", () => {
    const entries = [
      { competitionId: 100, paidAmountCents: 500 },
      { competitionId: 300, paidAmountCents: 2000 },
    ];
    const result = summarizeEntriesBySport(entries, COMPETITIONS, SPORTS, REGISTRY);
    expect(result.bySport.find((s) => s.sportCode === "nrl")!.entryCount).toBe(1);
    expect(result.bySport.find((s) => s.sportCode === "nrl")!.totalEntryValueCents).toBe(500);
    expect(result.bySport.find((s) => s.sportCode === "afl")!.entryCount).toBe(0);
    expect(result.bySport.find((s) => s.sportCode === "nba")!.entryCount).toBe(1);
    expect(result.bySport.find((s) => s.sportCode === "nba")!.totalEntryValueCents).toBe(2000);
  });

  it("an entry with paidAmountCents null (pending/failed/cancelled payment) is counted but contributes zero entry value", () => {
    const entries = [
      { competitionId: 300, paidAmountCents: null }, // e.g. a pending direct-payment entry
      { competitionId: 300, paidAmountCents: 500 },
    ];
    const result = summarizeEntriesBySport(entries, COMPETITIONS, SPORTS, REGISTRY);
    const nba = result.bySport.find((s) => s.sportCode === "nba")!;
    expect(nba.entryCount).toBe(2); // both entries exist and are counted
    expect(nba.totalEntryValueCents).toBe(500); // only the one with real paid money counts toward value
    expect(result.total).toBe(2);
    expect(result.totalEntryValueCents).toBe(500);
  });

  it("a refunded entry's paidAmountCents is NOT retroactively zeroed — entry value reflects money actually collected historically, matching the existing architecture (refunds live only in the payment_transactions ledger, never mutate competition_entries.paidAmountCents)", () => {
    // This is the exact current behavior: nothing in the codebase ever resets
    // paidAmountCents after a refund, so a $5 entry that was later refunded still
    // contributes $5 to entry value here — refunds are visible separately via
    // AdminEntryDetail.transactions / the dashboard's transactions.refundAttempts count.
    const entries = [{ competitionId: 100, paidAmountCents: 500 }];
    const result = summarizeEntriesBySport(entries, COMPETITIONS, SPORTS, REGISTRY);
    expect(result.bySport.find((s) => s.sportCode === "nrl")!.totalEntryValueCents).toBe(500);
  });

  it("entry value is never entryCount x a fixed price — it sums the real persisted paidAmountCents even when a package purchase attributes an uneven per-entry share", () => {
    // e.g. a $35/10-entry package: 350c per entry, not a flat $5 (500c) assumption.
    const entries = Array.from({ length: 10 }, () => ({ competitionId: 300, paidAmountCents: 350 }));
    const result = summarizeEntriesBySport(entries, COMPETITIONS, SPORTS, REGISTRY);
    const nba = result.bySport.find((s) => s.sportCode === "nba")!;
    expect(nba.entryCount).toBe(10);
    expect(nba.totalEntryValueCents).toBe(3500); // NOT 10 x 500 = 5000
  });

  it("total and totalEntryValueCents are computed independently of the per-sport buckets, so an entry whose sport can't be resolved still counts toward the grand total", () => {
    const entries = [{ competitionId: 999999, paidAmountCents: 500 }]; // no matching competition
    const result = summarizeEntriesBySport(entries, COMPETITIONS, SPORTS, REGISTRY);
    expect(result.total).toBe(1);
    expect(result.totalEntryValueCents).toBe(500);
    for (const bucket of result.bySport) expect(bucket.entryCount).toBe(0);
  });

  it("defaults to the real SPORTS registry (nrl/afl/nba/nfl) when no registry override is passed", () => {
    const result = summarizeEntriesBySport([], COMPETITIONS, SPORTS);
    expect(result.bySport.map((s) => s.sportCode).sort()).toEqual(["afl", "nba", "nfl", "nrl"]);
  });
});

describe("applyCommercialModel", () => {
  it("reproduces the exact worked demonstration scenario from the Phase 23E spec at 60%", () => {
    const summary = {
      total: 2250,
      totalEntryValueCents: 1_125_000, // $11,250
      bySport: [
        { sportCode: "nrl", sportName: "NRL", entryCount: 1000, totalEntryValueCents: 500_000 }, // $5,000
        { sportCode: "afl", sportName: "AFL", entryCount: 750, totalEntryValueCents: 375_000 }, // $3,750
        { sportCode: "nba", sportName: "NBA", entryCount: 500, totalEntryValueCents: 250_000 }, // $2,500
      ],
    };
    const result = applyCommercialModel(summary, 6000);

    expect(result.prizePoolAllocationBps).toBe(6000);
    expect(result.bySport.find((s) => s.sportCode === "nrl")).toMatchObject({ modeledPrizePoolCents: 300_000, commercialAllocationCents: 200_000 });
    expect(result.bySport.find((s) => s.sportCode === "afl")).toMatchObject({ modeledPrizePoolCents: 225_000, commercialAllocationCents: 150_000 });
    expect(result.bySport.find((s) => s.sportCode === "nba")).toMatchObject({ modeledPrizePoolCents: 150_000, commercialAllocationCents: 100_000 });
    expect(result.totalModeledPrizePoolCents).toBe(675_000); // $6,750
    expect(result.totalCommercialAllocationCents).toBe(450_000); // $4,500
  });

  it("NBA still shows a full economics row (all zeros) with zero entries — never hidden", () => {
    const summary = { total: 0, totalEntryValueCents: 0, bySport: [{ sportCode: "nba", sportName: "NBA", entryCount: 0, totalEntryValueCents: 0 }] };
    const result = applyCommercialModel(summary, 6000);
    expect(result.bySport[0]).toEqual({
      sportCode: "nba",
      sportName: "NBA",
      entryCount: 0,
      totalEntryValueCents: 0,
      modeledPrizePoolCents: 0,
      commercialAllocationCents: 0,
      uniqueCustomers: 0,
      perfectEntries: 0,
      perfectCustomers: 0,
      perfectRatePct: 0,
      rolloverCount: 0,
      rolloverAmountCents: 0,
      packageMix: [],
    });
  });

  it("passes through the configured percentage exactly, at any valid value, not just 60%", () => {
    const summary = { total: 1, totalEntryValueCents: 1000, bySport: [{ sportCode: "nrl", sportName: "NRL", entryCount: 1, totalEntryValueCents: 1000 }] };
    expect(applyCommercialModel(summary, 0).bySport[0]).toMatchObject({ modeledPrizePoolCents: 0, commercialAllocationCents: 1000 });
    expect(applyCommercialModel(summary, 10_000).bySport[0]).toMatchObject({ modeledPrizePoolCents: 1000, commercialAllocationCents: 0 });
  });
});

describe("summarizeSportAnalytics", () => {
  it("distinguishes PERFECT ENTRIES from PERFECT CUSTOMERS — 10 identical entries from 1 customer is 10 entries but 1 customer", () => {
    const entries = Array.from({ length: 10 }, () => ({ competitionId: 100, userId: 1, result: "perfect" as const }));
    const result = summarizeSportAnalytics(entries, COMPETITIONS.map((c) => ({ ...c, rolloverOutCents: 0, prizeSettledAt: null })), SPORTS, [], REGISTRY);
    expect(result.nrl.perfectEntries).toBe(10);
    expect(result.nrl.perfectCustomers).toBe(1);
    expect(result.nrl.uniqueCustomers).toBe(1);
    expect(result.nrl.perfectRatePct).toBe(100);
  });

  it("computes perfectRatePct correctly and returns 0 (not NaN) with zero entries", () => {
    const entries = [
      { competitionId: 100, userId: 1, result: "perfect" as const },
      { competitionId: 100, userId: 2, result: "not_perfect" as const },
      { competitionId: 100, userId: 3, result: "pending" as const },
      { competitionId: 100, userId: 4, result: "not_perfect" as const },
    ];
    const result = summarizeSportAnalytics(entries, COMPETITIONS.map((c) => ({ ...c, rolloverOutCents: 0, prizeSettledAt: null })), SPORTS, [], REGISTRY);
    expect(result.nrl.perfectRatePct).toBe(25);
    expect(result.afl.perfectRatePct).toBe(0);
  });

  it("counts a rollover only for a settled competition with a positive rolloverOutCents, summed per sport", () => {
    const competitions = [
      { id: 100, sportId: 1, rolloverOutCents: 6000, prizeSettledAt: new Date() }, // nrl round settled with 0 winners
      { id: 101, sportId: 1, rolloverOutCents: 0, prizeSettledAt: new Date() }, // nrl round settled WITH a winner -> no rollover
      { id: 200, sportId: 2, rolloverOutCents: 0, prizeSettledAt: null }, // afl round not settled yet
    ];
    const result = summarizeSportAnalytics([], competitions, SPORTS, [], REGISTRY);
    expect(result.nrl.rolloverCount).toBe(1);
    expect(result.nrl.rolloverAmountCents).toBe(6000);
    expect(result.afl.rolloverCount).toBe(0);
  });

  it("buckets package purchases by entry count, per sport, counting purchases not entries", () => {
    const packagePurchases = [
      { competitionId: 100, entryCount: 1 },
      { competitionId: 100, entryCount: 1 },
      { competitionId: 100, entryCount: 10 },
      { competitionId: 200, entryCount: 5 },
    ];
    const result = summarizeSportAnalytics([], COMPETITIONS.map((c) => ({ ...c, rolloverOutCents: 0, prizeSettledAt: null })), SPORTS, packagePurchases, REGISTRY);
    expect(result.nrl.packageMix).toEqual([
      { entryCount: 1, purchases: 2 },
      { entryCount: 10, purchases: 1 },
    ]);
    expect(result.afl.packageMix).toEqual([{ entryCount: 5, purchases: 1 }]);
    expect(result.nba.packageMix).toEqual([]);
  });

  it("every registered sport gets a full row, even with zero data anywhere", () => {
    const result = summarizeSportAnalytics([], [], [], [], REGISTRY);
    expect(result.nba).toEqual({ uniqueCustomers: 0, perfectEntries: 0, perfectCustomers: 0, perfectRatePct: 0, rolloverCount: 0, rolloverAmountCents: 0, packageMix: [] });
  });
});
