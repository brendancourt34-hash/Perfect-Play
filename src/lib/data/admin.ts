import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { GameStatus, SelectionResult } from "@/db/schema";
import { getEffectiveCompetitionState, hasFirstGameKickedOff } from "@/lib/competitions/lifecycle";
import { getRoundReadiness, type ReadinessBlockerCode, type RoundReadiness } from "@/lib/sports-data/readiness";
import { getNbaSportsDataConfig, getNflSportsDataConfig, getSportsDataConfig, type SportsDataProviderName } from "@/lib/sports-data/config";
import { settleGameSelection } from "@/lib/perfect2/settle";
import { calculateCommercialModel, resolvePrizePoolAllocationBps } from "@/lib/perfect2/commercial";
import { SPORTS } from "@/lib/sports/config";
import { getPrizePoolAllocationBps } from "./platform-settings";
import { safeQuery, type DataResult } from "./result";

/**
 * Read-only aggregation for the admin dashboard (Phase 18) — every number here is derived
 * from the same tables/rows the customer-facing code already reads and writes. This file
 * never computes a settlement result itself: entry/game results are read as already
 * stored (written by src/lib/data/settlement.ts), and settleGameSelection is used purely
 * to redisplay an already-known pair of stored per-player results as a game-level state —
 * not to re-run settlement logic. Close/settle actions themselves live in
 * src/lib/data/competitions.ts and src/lib/data/settlement.ts and are called directly by
 * the admin API routes — this file does not duplicate them.
 */

export interface AdminSportEntryCountSummary {
  sportCode: string;
  sportName: string;
  entryCount: number;
  /**
   * Sum of competition_entries.paidAmountCents across this sport's entries — the
   * authoritative "money actually collected" figure, not entryCount × price. paidAmountCents
   * is only ever set once a payment genuinely reached "paid" (the direct-charge flow) or
   * immediately for a wallet-funded entry-package purchase (already-settled internal
   * debit) — see src/lib/data/entries.ts and src/lib/data/entry-packages.ts. It is null,
   * and therefore excluded here, for pending/failed/cancelled payments. A later refund
   * transaction does NOT reduce this figure in the current architecture — refunds remain
   * visible separately in the payment_transactions ledger (see AdminEntryDetail.transactions
   * and the `transactions.refundAttempts` count below), exactly matching how the rest of
   * this dashboard already treats paidAmountCents as a fixed historical fact rather than a
   * running balance. This IS "Entry Revenue" (Phase 23E terminology).
   */
  totalEntryValueCents: number;
}

/** One entry per configured entry-package size actually purchased for this sport, e.g. [{entryCount:1,purchases:12},{entryCount:5,purchases:4},{entryCount:10,purchases:9}] — counted by PURCHASE (one wallet_transactions row per package buy), never by individual entry, so a 10-entry package always counts as one purchase of size 10, not ten purchases of size 1. */
export interface PackageMixRow {
  entryCount: number;
  purchases: number;
}

export interface AdminSportEntrySummary extends AdminSportEntryCountSummary {
  /**
   * Phase 23E commercial-economics MODEL — entirely separate from the real, authoritative
   * prizeAmountCents/rollover pool a winner is actually paid from (see
   * src/lib/perfect2/prize.ts and src/lib/perfect2/commercial.ts's file-level comment for
   * why these are deliberately different concepts). Computed by applying the GLOBAL
   * prize-pool-allocation percentage to this sport's totalEntryValueCents — dashboard-level
   * sport aggregation spans many competitions at once, so a single competition's own
   * override (competitions.prizePoolAllocationBps) is not meaningful here; per-competition
   * overrides are only resolved and shown on that one competition's own detail page
   * (see AdminCompetitionDetail below). This is a demonstration/reporting figure only — it
   * does not represent a final commercial or regulatory agreement with any partner.
   */
  modeledPrizePoolCents: number;
  /** Entry Revenue minus modeledPrizePoolCents — a neutral remainder figure, never labeled profit/partner revenue/Perfect Play revenue anywhere in this codebase (see docs/phase23e-commercial-economics.md). */
  commercialAllocationCents: number;
  /** Distinct customers who hold at least one entry in this sport (across every round/competition) — never the same as entryCount, since one customer's 10-entry package is 10 entries but 1 unique customer. */
  uniqueCustomers: number;
  /** Entries whose result is "perfect" — counts ENTRIES, not customers (see perfectCustomers). */
  perfectEntries: number;
  /** Distinct customers who hold at least one PERFECT entry — a customer with 10 identical PERFECT entries is 1 perfect customer but 10 perfect entries. */
  perfectCustomers: number;
  /** perfectEntries / entryCount, as a percentage (0-100), 0 when entryCount is 0. */
  perfectRatePct: number;
  /** Number of this sport's competitions that settled with zero PERFECT entries (i.e. rolled their pool over). */
  rolloverCount: number;
  /** Sum of rolloverOutCents across every one of this sport's settled-with-no-winners competitions. */
  rolloverAmountCents: number;
  packageMix: PackageMixRow[];
}

export interface AdminDashboard {
  competitions: { open: number; closed: number; settled: number };
  entries: {
    total: number;
    /** Sum of totalEntryValueCents across every sport — server-computed, never derived by summing client-rendered rows. */
    totalEntryValueCents: number;
    /** The GLOBAL prize-pool-allocation percentage (basis points, 6000 = 60%) used to compute every bySport row's modeledPrizePoolCents/commercialAllocationCents below — see src/lib/data/platform-settings.ts:getPrizePoolAllocationBps. Admin-configurable at /admin/settings. */
    prizePoolAllocationBps: number;
    /** Sum of modeledPrizePoolCents across every sport. */
    totalModeledPrizePoolCents: number;
    /** Sum of commercialAllocationCents across every sport. */
    totalCommercialAllocationCents: number;
    /** One row per registered Perfect Play sport (src/lib/sports/config.ts SPORTS), in registry order — always present, including sports with zero entries. Never limited to whichever sports happen to already have entries. */
    bySport: AdminSportEntrySummary[];
  };
  payments: { pending: number; paid: number; failed: number; cancelled: number; refunded: number };
  results: { pending: number; perfect: number; notPerfect: number };
  data: { competitionsChecked: number; ready: number; notReady: number };
  /**
   * Transaction-level view (Phase 20's payment_transactions table) alongside the
   * entry-level `payments` counts above — the two are related but not identical: a single
   * entry can have multiple transaction attempts (a failed retry, or a payment plus a
   * later refund), so these totals are independently useful for spotting stuck/failed
   * attempts that never resulted in an entry at all. Never filtered by sport — every
   * transaction regardless of which sport's competition it belongs to is counted here.
   */
  transactions: { pending: number; paid: number; failed: number; cancelled: number; refunded: number; refundAttempts: number };
  /**
   * The currently configured sports-data provider(s) (Phase 21/22) — "none" unless an
   * operator explicitly configured one. Never implies a live connection just because a
   * name is configured; see src/lib/sports-data/registry.ts. NRL and AFL currently share
   * one provider configuration (Champion Data — not yet connected); NBA has its own,
   * separate configuration (the real, live, keyless ESPN provider by default) — this is
   * the actual architecture, not an arbitrary per-sport split, so it's reported as exactly
   * two rows rather than one row per sport.
   */
  sportsDataProviders: { label: string; provider: SportsDataProviderName }[];
}

export interface EntryForSportSummary {
  competitionId: number;
  paidAmountCents: number | null;
}
export interface CompetitionForSportSummary {
  id: number;
  sportId: number;
}
export interface SportRowForSummary {
  id: number;
  code: string;
}

/**
 * Pure aggregation, extracted so it's unit-testable without a database: buckets every
 * entry into its competition's sport, seeded from the sport REGISTRY (src/lib/sports/config.ts)
 * so every supported sport gets a row even with zero entries — never derived from whichever
 * sports happen to already have entries or even already have a `sports` table row. An
 * entry whose competition/sport can't be resolved contributes to neither a per-sport bucket
 * nor totalEntryValueCents's sport-scoped half, but IS still counted in `total` and in the
 * overall totalEntryValueCents — this only happens for orphaned data, never in normal
 * operation, and undercounting a specific sport bucket in that edge case is preferable to
 * guessing which sport an unresolvable entry belongs to.
 */
export function summarizeEntriesBySport(
  entries: readonly EntryForSportSummary[],
  competitions: readonly CompetitionForSportSummary[],
  sports: readonly SportRowForSummary[],
  sportRegistry: Record<string, { code: string; name: string }> = SPORTS,
): { total: number; totalEntryValueCents: number; bySport: AdminSportEntryCountSummary[] } {
  const competitionById = new Map(competitions.map((c) => [c.id, c]));
  const sportById = new Map(sports.map((s) => [s.id, s]));
  const bySportSummary = new Map<string, AdminSportEntryCountSummary>(
    Object.values(sportRegistry).map((s) => [s.code, { sportCode: s.code, sportName: s.name, entryCount: 0, totalEntryValueCents: 0 }]),
  );
  let totalEntryValueCents = 0;
  for (const e of entries) {
    const competition = competitionById.get(e.competitionId);
    const sportCode = competition ? sportById.get(competition.sportId)?.code : undefined;
    const bucket = sportCode ? bySportSummary.get(sportCode) : undefined;
    if (bucket) {
      bucket.entryCount++;
      if (e.paidAmountCents !== null) bucket.totalEntryValueCents += e.paidAmountCents;
    }
    if (e.paidAmountCents !== null) totalEntryValueCents += e.paidAmountCents;
  }
  return { total: entries.length, totalEntryValueCents, bySport: Array.from(bySportSummary.values()) };
}

export interface EntryForCustomerSummary {
  competitionId: number;
  userId: number;
  result: "pending" | "perfect" | "not_perfect";
}
export interface CompetitionForRolloverSummary {
  id: number;
  sportId: number;
  rolloverOutCents: number;
  prizeSettledAt: Date | null;
}
export interface PackagePurchaseForMix {
  competitionId: number;
  entryCount: number;
}

export interface SportAnalyticsRow {
  uniqueCustomers: number;
  perfectEntries: number;
  perfectCustomers: number;
  perfectRatePct: number;
  rolloverCount: number;
  rolloverAmountCents: number;
  packageMix: PackageMixRow[];
}

/**
 * Pure aggregation (no I/O, unit-testable without a database — same convention as
 * summarizeEntriesBySport above): distinct customers, PERFECT entries vs. PERFECT
 * CUSTOMERS (deliberately different — a customer with 10 identical PERFECT entries is 1
 * PERFECT customer but 10 PERFECT entries, per the product's "entries determine shares,
 * not unique customers" rule), rollover counts/amounts, and package-size mix, all bucketed
 * per sport from the sport REGISTRY (every sport gets a row, even with zero data).
 */
export function summarizeSportAnalytics(
  entries: readonly EntryForCustomerSummary[],
  competitions: readonly CompetitionForRolloverSummary[],
  sports: readonly SportRowForSummary[],
  packagePurchases: readonly PackagePurchaseForMix[],
  sportRegistry: Record<string, { code: string; name: string }> = SPORTS,
): Record<string, SportAnalyticsRow> {
  const sportById = new Map(sports.map((s) => [s.id, s]));
  const sportCodeByCompetitionId = new Map<number, string>();
  for (const c of competitions) {
    const code = sportById.get(c.sportId)?.code;
    if (code) sportCodeByCompetitionId.set(c.id, code);
  }

  interface Bucket {
    customers: Set<number>;
    perfectCustomers: Set<number>;
    perfectEntries: number;
    totalEntries: number;
    packageMix: Map<number, number>;
    rolloverCount: number;
    rolloverAmountCents: number;
  }
  const bySport = new Map<string, Bucket>();
  for (const s of Object.values(sportRegistry)) {
    bySport.set(s.code, { customers: new Set(), perfectCustomers: new Set(), perfectEntries: 0, totalEntries: 0, packageMix: new Map(), rolloverCount: 0, rolloverAmountCents: 0 });
  }

  for (const e of entries) {
    const code = sportCodeByCompetitionId.get(e.competitionId);
    const bucket = code ? bySport.get(code) : undefined;
    if (!bucket) continue;
    bucket.customers.add(e.userId);
    bucket.totalEntries++;
    if (e.result === "perfect") {
      bucket.perfectEntries++;
      bucket.perfectCustomers.add(e.userId);
    }
  }

  for (const p of packagePurchases) {
    const code = sportCodeByCompetitionId.get(p.competitionId);
    const bucket = code ? bySport.get(code) : undefined;
    if (!bucket || p.entryCount <= 0) continue;
    bucket.packageMix.set(p.entryCount, (bucket.packageMix.get(p.entryCount) ?? 0) + 1);
  }

  for (const c of competitions) {
    const code = sportById.get(c.sportId)?.code;
    const bucket = code ? bySport.get(code) : undefined;
    if (!bucket) continue;
    if (c.prizeSettledAt && c.rolloverOutCents > 0) {
      bucket.rolloverCount++;
      bucket.rolloverAmountCents += c.rolloverOutCents;
    }
  }

  const result: Record<string, SportAnalyticsRow> = {};
  for (const [code, bucket] of bySport) {
    result[code] = {
      uniqueCustomers: bucket.customers.size,
      perfectEntries: bucket.perfectEntries,
      perfectCustomers: bucket.perfectCustomers.size,
      perfectRatePct: bucket.totalEntries > 0 ? Math.round((bucket.perfectEntries / bucket.totalEntries) * 10000) / 100 : 0,
      rolloverCount: bucket.rolloverCount,
      rolloverAmountCents: bucket.rolloverAmountCents,
      packageMix: Array.from(bucket.packageMix.entries())
        .map(([entryCount, purchases]) => ({ entryCount, purchases }))
        .sort((a, b) => a.entryCount - b.entryCount),
    };
  }
  return result;
}

/**
 * Layers the Phase 23E commercial-economics model (src/lib/perfect2/commercial.ts) onto an
 * already-computed entry/sport summary — kept as its own pure function so
 * summarizeEntriesBySport's existing behavior/tests are untouched and this layer can be
 * unit-tested independently. Applies the same GLOBAL prizePoolAllocationBps to every
 * sport's totalEntryValueCents (dashboard-level aggregation spans many competitions at
 * once, so a single competition's own override isn't meaningful here — see
 * AdminSportEntrySummary's doc comment).
 */
export function applyCommercialModel(
  summary: { total: number; totalEntryValueCents: number; bySport: readonly { sportCode: string; sportName: string; entryCount: number; totalEntryValueCents: number }[] },
  prizePoolAllocationBps: number,
): AdminDashboard["entries"] {
  // Analytics fields (uniqueCustomers, perfectEntries, etc.) default to zero here and are
  // filled in by the caller (getAdminDashboard) via summarizeSportAnalytics — kept as a
  // separate pure function/step so this function's existing behavior/tests are untouched.
  const zeroAnalytics: SportAnalyticsRow = { uniqueCustomers: 0, perfectEntries: 0, perfectCustomers: 0, perfectRatePct: 0, rolloverCount: 0, rolloverAmountCents: 0, packageMix: [] };
  const bySport: AdminSportEntrySummary[] = summary.bySport.map((s) => {
    const model = calculateCommercialModel(s.totalEntryValueCents, prizePoolAllocationBps);
    return { ...s, modeledPrizePoolCents: model.modeledPrizePoolCents, commercialAllocationCents: model.commercialAllocationCents, ...zeroAnalytics };
  });
  const totalModel = calculateCommercialModel(summary.totalEntryValueCents, prizePoolAllocationBps);
  return {
    total: summary.total,
    totalEntryValueCents: summary.totalEntryValueCents,
    prizePoolAllocationBps,
    totalModeledPrizePoolCents: totalModel.modeledPrizePoolCents,
    totalCommercialAllocationCents: totalModel.commercialAllocationCents,
    bySport,
  };
}

export async function getAdminDashboard(): Promise<DataResult<AdminDashboard>> {
  return safeQuery(async () => {
    const db = getDb();
    const competitions = await db.select().from(schema.competitions);
    const entries = await db.select().from(schema.competitionEntries);
    const sports = await db.select().from(schema.sports);
    const transactions = await db.select().from(schema.paymentTransactions);

    const transactionCounts = { pending: 0, paid: 0, failed: 0, cancelled: 0, refunded: 0, refundAttempts: 0 };
    for (const t of transactions) {
      if (t.status in transactionCounts) transactionCounts[t.status as keyof typeof transactionCounts]++;
      if (t.transactionType === "refund") transactionCounts.refundAttempts++;
    }

    const competitionCounts = { open: 0, closed: 0, settled: 0 };
    for (const c of competitions) {
      const state = getEffectiveCompetitionState(c);
      if (state === "settled") competitionCounts.settled++;
      else if (state === "closed") competitionCounts.closed++;
      else if (state === "open") competitionCounts.open++;
      // "not_yet_open" competitions aren't customer-facing yet — not counted in any bucket here.
    }

    const entrySportSummaryBase = summarizeEntriesBySport(entries, competitions, sports);
    const globalPrizePoolAllocationBpsResult = await getPrizePoolAllocationBps();
    if (globalPrizePoolAllocationBpsResult.status === "unavailable") throw new Error(globalPrizePoolAllocationBpsResult.message);
    const entrySportSummary = applyCommercialModel(entrySportSummaryBase, globalPrizePoolAllocationBpsResult.data);

    // Package purchases (Feature 6): one wallet_transactions row per package BUY (never
    // per individual entry) — relatedEntryIds.length is exactly the package size that
    // purchase created. Only "entry_purchase" debits with a real linked competition are
    // meaningful here; nothing else in this codebase produces that shape.
    const packageTransactions = await db.select().from(schema.walletTransactions).where(eq(schema.walletTransactions.type, "entry_purchase"));
    const packagePurchases: PackagePurchaseForMix[] = packageTransactions
      .filter((t) => t.relatedCompetitionId != null && (t.relatedEntryIds?.length ?? 0) > 0)
      .map((t) => ({ competitionId: t.relatedCompetitionId!, entryCount: t.relatedEntryIds!.length }));
    const sportAnalytics = summarizeSportAnalytics(
      entries.map((e) => ({ competitionId: e.competitionId, userId: e.userId, result: e.result })),
      competitions.map((c) => ({ id: c.id, sportId: c.sportId, rolloverOutCents: c.rolloverOutCents, prizeSettledAt: c.prizeSettledAt })),
      sports,
      packagePurchases,
    );
    for (const row of entrySportSummary.bySport) {
      Object.assign(row, sportAnalytics[row.sportCode]);
    }

    const paymentCounts = { pending: 0, paid: 0, failed: 0, cancelled: 0, refunded: 0 };
    const resultCounts = { pending: 0, perfect: 0, notPerfect: 0 };
    for (const e of entries) {
      if (e.paymentStatus in paymentCounts) paymentCounts[e.paymentStatus as keyof typeof paymentCounts]++;
      if (e.result === "pending") resultCounts.pending++;
      else if (e.result === "perfect") resultCounts.perfect++;
      else resultCounts.notPerfect++;
    }

    // Data readiness: only meaningful for competitions not yet settled.
    const unsettled = competitions.filter((c) => getEffectiveCompetitionState(c) !== "settled");
    let ready = 0;
    for (const c of unsettled) {
      const readiness = await getRoundReadiness(c.roundId);
      if (readiness.status === "ok" && readiness.data.ready) ready++;
    }

    return {
      competitions: competitionCounts,
      entries: entrySportSummary,
      payments: paymentCounts,
      results: resultCounts,
      data: { competitionsChecked: unsettled.length, ready, notReady: unsettled.length - ready },
      transactions: transactionCounts,
      sportsDataProviders: [
        { label: "NRL / AFL (Champion Data)", provider: getSportsDataConfig().provider },
        { label: "NBA (ESPN)", provider: getNbaSportsDataConfig().provider },
        { label: "NFL (Unconfigured)", provider: getNflSportsDataConfig().provider },
      ],
    };
  });
}

export interface AdminCompetitionSummary {
  competitionId: number;
  sportCode: string;
  sportName: string;
  roundId: number;
  roundName: string | null;
  roundNumber: number;
  state: "not_yet_open" | "open" | "closed" | "settled";
  entryFeeCents: number;
  /** Configured base prize — unchanged meaning (Phase 19). */
  prizeAmountCents: number;
  /** Rollover this competition received from the previous same-sport competition, if any. */
  rolloverInCents: number;
  /** Base + rollover — the actual current pool. */
  currentPrizePoolCents: number;
  /** Authoritative once prizeSettledAt is set; 0 before that. */
  winnerCount: number;
  /** Authoritative once prizeSettledAt is set; 0 before that or if there were no winners. */
  awardedAmountCents: number;
  /** The amount this competition will pass on to the next same-sport competition — only nonzero once settled with zero winners. */
  rolloverOutCents: number;
  prizeSettledAt: Date | null;
  entryCount: number;
  opensAt: Date | null;
  closesAt: Date | null;
  /** Phase 21: the round's first game kickoff — the authoritative buy-in cutoff, same value as closesAt once set, exposed explicitly for clarity. */
  firstGameKickoffAt: Date | null;
  buyInCutoffAt: Date | null;
  /** Whether the CUSTOMER-facing API currently exposes currentPrizePoolCents — false before the first game kicks off. currentPrizePoolCents above is always the real internal value regardless (this is an internal admin view). */
  prizePoolVisible: boolean;
  /** True once every game in the round has a known kickoff and a released team list. */
  teamListsReady: boolean;
  readinessBlockers: ReadinessBlockerCode[];
  gamesTotal: number;
  gamesWithCompletePlayerLists: number;
  gamesMissingPlayerData: number;
}

export async function listAdminCompetitions(): Promise<DataResult<AdminCompetitionSummary[]>> {
  return safeQuery(async () => {
    const db = getDb();
    const competitions = await db.select().from(schema.competitions).orderBy(desc(schema.competitions.createdAt));
    if (competitions.length === 0) return [];

    const sportIds = Array.from(new Set(competitions.map((c) => c.sportId)));
    const roundIds = Array.from(new Set(competitions.map((c) => c.roundId)));
    const [sports, rounds, entries, readinessResults] = await Promise.all([
      db.select().from(schema.sports).where(inArray(schema.sports.id, sportIds)),
      db.select().from(schema.rounds).where(inArray(schema.rounds.id, roundIds)),
      db.select().from(schema.competitionEntries).where(inArray(schema.competitionEntries.competitionId, competitions.map((c) => c.id))),
      Promise.all(competitions.map((c) => getRoundReadiness(c.roundId))),
    ]);
    const sportById = new Map(sports.map((s) => [s.id, s]));
    const roundById = new Map(rounds.map((r) => [r.id, r]));
    const entryCountByCompetition = new Map<number, number>();
    for (const e of entries) entryCountByCompetition.set(e.competitionId, (entryCountByCompetition.get(e.competitionId) ?? 0) + 1);

    return competitions.map((c, i) => {
      const sport = sportById.get(c.sportId);
      const round = roundById.get(c.roundId);
      const readinessResult = readinessResults[i];
      const readiness = readinessResult.status === "ok" ? readinessResult.data : null;
      const firstGameKickoffAt = readiness?.firstGameKickoffAt ?? null;
      return {
        competitionId: c.id,
        sportCode: sport?.code ?? "unknown",
        sportName: sport?.name ?? "Unknown sport",
        roundId: c.roundId,
        roundName: round?.name ?? null,
        roundNumber: round?.roundNumber ?? 0,
        state: getEffectiveCompetitionState(c),
        entryFeeCents: c.entryFeeCents,
        prizeAmountCents: c.prizeAmountCents,
        rolloverInCents: c.rolloverInCents,
        currentPrizePoolCents: c.prizeAmountCents + c.rolloverInCents,
        winnerCount: c.winnerCount,
        awardedAmountCents: c.awardedAmountCents,
        rolloverOutCents: c.rolloverOutCents,
        prizeSettledAt: c.prizeSettledAt,
        entryCount: entryCountByCompetition.get(c.id) ?? 0,
        opensAt: c.opensAt,
        closesAt: c.closesAt,
        firstGameKickoffAt,
        buyInCutoffAt: firstGameKickoffAt,
        prizePoolVisible: hasFirstGameKickedOff(firstGameKickoffAt),
        teamListsReady: readiness?.teamListsReady ?? false,
        readinessBlockers: readiness?.blockers ?? [],
        gamesTotal: readiness?.gamesTotal ?? 0,
        gamesWithCompletePlayerLists: readiness?.games.filter((g) => g.teamListReady).length ?? 0,
        gamesMissingPlayerData: readiness?.games.filter((g) => !g.teamListReady).length ?? 0,
      };
    });
  });
}

export interface AdminGameSummary {
  gameId: number;
  homeTeamName: string;
  awayTeamName: string;
  kickoff: Date | null;
  status: GameStatus;
  homeScore: number | null;
  awayScore: number | null;
  hasLineups: boolean;
  hasStatsIfFinal: boolean;
  /** Phase 21: does this specific game have a known kickoff and a released (2+ player) team list? */
  teamListReady: boolean;
  readinessBlockers: ReadinessBlockerCode[];
}

/**
 * Phase 23E commercial-economics model for ONE competition — kept entirely separate from
 * the sibling fields on AdminCompetitionSummary (prizeAmountCents, rolloverInCents,
 * currentPrizePoolCents, winnerCount, awardedAmountCents) which remain the real,
 * authoritative prize pool a winner is actually paid from. Unlike the dashboard's
 * sport-level version (AdminSportEntrySummary), this DOES resolve a per-competition
 * override (competitions.prizePoolAllocationBps) since exactly one competition is in
 * scope here — see resolvePrizePoolAllocationBps, src/lib/perfect2/commercial.ts.
 */
export interface AdminCompetitionCommercialEconomics {
  /** Sum of this competition's paid entries' paidAmountCents — see AdminSportEntryCountSummary.totalEntryValueCents for the exact same semantic. */
  entryRevenueCents: number;
  /** This competition's own override if set, else the global default (basis points, 6000 = 60%). */
  prizePoolAllocationBps: number;
  /** Whether prizePoolAllocationBps above came from this competition's own override (true) or the global default (false) — lets the UI show "60% (global default)" vs "70% (override)". */
  isOverridden: boolean;
  modeledPrizePoolCents: number;
  commercialAllocationCents: number;
}

/** How many of this round's ENTRIES had exactly `correctCount` correct selections — the generalized "7/8 rate"/"6/8 rate" for NRL/NBA/NFL (or "8/9"/"7/9" for AFL), covering every possible correct-count from 0 through the round's total games. */
export interface CorrectCountDistributionRow {
  correctCount: number;
  entries: number;
}

/** One eligible player's share of the picks made for one game — "percentage of customers selecting each player" from the product spec, computed over ENTRIES (so a customer's 10 identical entries count 10 times, matching how every other per-entry figure on this page already counts). */
export interface PlayerSelectionShare {
  playerId: number;
  playerName: string;
  pickCount: number;
  pickPercentage: number;
}

export interface GameSelectionDistribution {
  gameId: number;
  homeTeamName: string;
  awayTeamName: string;
  players: PlayerSelectionShare[];
}

export interface AdminCompetitionDetail extends AdminCompetitionSummary {
  seasonLabel: string;
  paymentSummary: { pending: number; paid: number; failed: number; cancelled: number; refunded: number };
  resultSummary: { pending: number; perfect: number; notPerfect: number };
  readiness: RoundReadiness;
  games: AdminGameSummary[];
  /** Distinct customers holding at least one entry in this competition — never the same as entryCount. */
  uniqueCustomers: number;
  /** Distinct customers holding at least one PERFECT entry — see AdminSportEntrySummary.perfectCustomers for the same "entries vs customers" distinction, scoped to this one competition. */
  perfectCustomers: number;
  /** awardedAmountCents / winnerCount once settled with at least one winner — null before settlement or when there were zero winners (the whole pool rolled over instead, see rolloverOutCents). Settlement information only — never shown before the competition is settled. */
  payoutPerPerfectEntryCents: number | null;
  /** Number of genuinely DIFFERENT pick combinations among this competition's customers — one canonical selection set per customer, deduplicated by content; two customers who independently picked identically count once here, even though they're 2 unique customers. */
  sharedSelectionSetCount: number;
  /** Package-size mix for THIS competition only (see AdminSportEntrySummary.packageMix for the sport-wide version). */
  packageDistribution: PackageMixRow[];
  correctCountDistribution: CorrectCountDistributionRow[];
  selectionDistribution: GameSelectionDistribution[];
  commercialEconomics: AdminCompetitionCommercialEconomics;
}

export async function getAdminCompetitionDetail(competitionId: number): Promise<DataResult<AdminCompetitionDetail | null>> {
  return safeQuery(async () => {
    const db = getDb();
    const rows = await db.select().from(schema.competitions).where(eq(schema.competitions.id, competitionId)).limit(1);
    const competition = rows[0];
    if (!competition) return null;

    const [sportRows, roundRows] = await Promise.all([
      db.select().from(schema.sports).where(eq(schema.sports.id, competition.sportId)).limit(1),
      db.select().from(schema.rounds).where(eq(schema.rounds.id, competition.roundId)).limit(1),
    ]);
    const sport = sportRows[0];
    const round = roundRows[0];
    const seasonRows = round ? await db.select().from(schema.seasons).where(eq(schema.seasons.id, round.seasonId)).limit(1) : [];
    const season = seasonRows[0];

    const entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, competitionId));
    const paymentSummary = { pending: 0, paid: 0, failed: 0, cancelled: 0, refunded: 0 };
    const resultSummary = { pending: 0, perfect: 0, notPerfect: 0 };
    for (const e of entries) {
      if (e.paymentStatus in paymentSummary) paymentSummary[e.paymentStatus as keyof typeof paymentSummary]++;
      if (e.result === "pending") resultSummary.pending++;
      else if (e.result === "perfect") resultSummary.perfect++;
      else resultSummary.notPerfect++;
    }

    const entryRevenueCents = entries.reduce((sum, e) => sum + (e.paidAmountCents ?? 0), 0);
    const globalPrizePoolAllocationBpsResult = await getPrizePoolAllocationBps();
    if (globalPrizePoolAllocationBpsResult.status === "unavailable") throw new Error(globalPrizePoolAllocationBpsResult.message);
    const resolvedPrizePoolAllocationBps = resolvePrizePoolAllocationBps(competition.prizePoolAllocationBps, globalPrizePoolAllocationBpsResult.data);
    const commercialModel = calculateCommercialModel(entryRevenueCents, resolvedPrizePoolAllocationBps);
    const commercialEconomics: AdminCompetitionCommercialEconomics = {
      entryRevenueCents,
      prizePoolAllocationBps: resolvedPrizePoolAllocationBps,
      isOverridden: competition.prizePoolAllocationBps !== null,
      modeledPrizePoolCents: commercialModel.modeledPrizePoolCents,
      commercialAllocationCents: commercialModel.commercialAllocationCents,
    };

    const readinessResult = await getRoundReadiness(competition.roundId);
    if (readinessResult.status === "unavailable") throw new Error(readinessResult.message);
    const readiness = readinessResult.data;
    const readinessByGame = new Map(readiness.games.map((g) => [g.gameId, g]));

    const gamesRows = await db.select().from(schema.games).where(eq(schema.games.roundId, competition.roundId));
    const teamIds = Array.from(new Set(gamesRows.flatMap((g) => [g.homeTeamId, g.awayTeamId])));
    const teams = teamIds.length ? await db.select().from(schema.teams).where(inArray(schema.teams.id, teamIds)) : [];
    const teamById = new Map(teams.map((t) => [t.id, t]));

    const games: AdminGameSummary[] = gamesRows.map((g) => {
      const r = readinessByGame.get(g.id);
      return {
        gameId: g.id,
        homeTeamName: teamById.get(g.homeTeamId)?.name ?? "TBC",
        awayTeamName: teamById.get(g.awayTeamId)?.name ?? "TBC",
        kickoff: g.kickoff,
        status: g.status,
        homeScore: g.homeScore,
        awayScore: g.awayScore,
        hasLineups: r?.hasLineups ?? false,
        hasStatsIfFinal: r?.hasStatsIfFinal ?? false,
        teamListReady: r?.teamListReady ?? false,
        readinessBlockers: r?.blockers ?? [],
      };
    });

    // --- Feature 6 (admin analytics): customers, package mix, selection distribution ---
    const uniqueCustomers = new Set(entries.map((e) => e.userId)).size;
    const perfectCustomers = new Set(entries.filter((e) => e.result === "perfect").map((e) => e.userId)).size;
    const payoutPerPerfectEntryCents = competition.prizeSettledAt && competition.winnerCount > 0 ? Math.floor(competition.awardedAmountCents / competition.winnerCount) : null;

    const packageTransactions = await db
      .select()
      .from(schema.walletTransactions)
      .where(and(eq(schema.walletTransactions.type, "entry_purchase"), eq(schema.walletTransactions.relatedCompetitionId, competitionId)));
    const packageMixCounts = new Map<number, number>();
    for (const t of packageTransactions) {
      const size = t.relatedEntryIds?.length ?? 0;
      if (size <= 0) continue;
      packageMixCounts.set(size, (packageMixCounts.get(size) ?? 0) + 1);
    }
    const packageDistribution: PackageMixRow[] = Array.from(packageMixCounts.entries())
      .map(([entryCount, purchases]) => ({ entryCount, purchases }))
      .sort((a, b) => a.entryCount - b.entryCount);

    const entrySelectionRows = entries.length
      ? await db.select().from(schema.entrySelections).where(inArray(schema.entrySelections.entryId, entries.map((e) => e.id)))
      : [];
    const selectionsByEntryId = new Map<number, typeof entrySelectionRows>();
    for (const s of entrySelectionRows) {
      if (!selectionsByEntryId.has(s.entryId)) selectionsByEntryId.set(s.entryId, []);
      selectionsByEntryId.get(s.entryId)!.push(s);
    }

    // Correct-count distribution (the generalized "7/8 rate"): one bucket per possible
    // number of correct picks, counted per ENTRY (not per customer) — consistent with
    // resultSummary/entryCount above, which also count entries.
    const correctCountCounts = new Map<number, number>();
    for (const entry of entries) {
      const rowsForEntry = selectionsByEntryId.get(entry.id) ?? [];
      let correct = 0;
      for (const s of rowsForEntry) {
        const gameResult = settleGameSelection(s.selectedPlayer2Id != null ? [s.player1Result, s.player2Result!] : [s.player1Result]);
        if (gameResult === "perfect") correct++;
      }
      correctCountCounts.set(correct, (correctCountCounts.get(correct) ?? 0) + 1);
    }
    const correctCountDistribution: CorrectCountDistributionRow[] = Array.from(correctCountCounts.entries())
      .map(([correctCount, count]) => ({ correctCount, entries: count }))
      .sort((a, b) => a.correctCount - b.correctCount);

    // Shared-selection-set count: canonical selections are identical across every entry a
    // customer holds (see entry-packages.ts), so this dedupes by CUSTOMER first, then by
    // the actual content of their pick set — two customers who happened to pick identically
    // collapse to one set here, which is the point (this counts genuinely different
    // combinations in play, not just headcount — see uniqueCustomers for headcount).
    const firstEntryIdByUser = new Map<number, number>();
    for (const e of entries) if (!firstEntryIdByUser.has(e.userId)) firstEntryIdByUser.set(e.userId, e.id);
    const distinctCombinations = new Set<string>();
    for (const entryId of firstEntryIdByUser.values()) {
      const rowsForEntry = (selectionsByEntryId.get(entryId) ?? []).slice().sort((a, b) => a.gameId - b.gameId);
      distinctCombinations.add(rowsForEntry.map((s) => `${s.gameId}:${s.selectedPlayer1Id}`).join(","));
    }
    const sharedSelectionSetCount = distinctCombinations.size;

    // Selection distribution by player, per game — "percentage of customers selecting
    // each player" from the product spec, computed over every entry (a customer's 10
    // identical entries contribute 10 picks, matching every other per-entry count here).
    const allPlayerIds = Array.from(new Set(entrySelectionRows.map((s) => s.selectedPlayer1Id)));
    const players = allPlayerIds.length ? await db.select().from(schema.players).where(inArray(schema.players.id, allPlayerIds)) : [];
    const playerNameById = new Map(players.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
    const picksByGame = new Map<number, Map<number, number>>();
    for (const s of entrySelectionRows) {
      if (!picksByGame.has(s.gameId)) picksByGame.set(s.gameId, new Map());
      const byPlayer = picksByGame.get(s.gameId)!;
      byPlayer.set(s.selectedPlayer1Id, (byPlayer.get(s.selectedPlayer1Id) ?? 0) + 1);
    }
    const selectionDistribution: GameSelectionDistribution[] = gamesRows.map((g) => {
      const byPlayer = picksByGame.get(g.id) ?? new Map<number, number>();
      const totalPicksForGame = Array.from(byPlayer.values()).reduce((a, b) => a + b, 0);
      const playerShares: PlayerSelectionShare[] = Array.from(byPlayer.entries())
        .map(([playerId, pickCount]) => ({
          playerId,
          playerName: playerNameById.get(playerId) ?? "Unknown player",
          pickCount,
          pickPercentage: totalPicksForGame > 0 ? Math.round((pickCount / totalPicksForGame) * 10000) / 100 : 0,
        }))
        .sort((a, b) => b.pickCount - a.pickCount);
      return {
        gameId: g.id,
        homeTeamName: teamById.get(g.homeTeamId)?.name ?? "TBC",
        awayTeamName: teamById.get(g.awayTeamId)?.name ?? "TBC",
        players: playerShares,
      };
    });

    return {
      competitionId: competition.id,
      sportCode: sport?.code ?? "unknown",
      sportName: sport?.name ?? "Unknown sport",
      roundId: competition.roundId,
      roundName: round?.name ?? null,
      roundNumber: round?.roundNumber ?? 0,
      seasonLabel: season?.label ?? "Unknown season",
      state: getEffectiveCompetitionState(competition),
      entryFeeCents: competition.entryFeeCents,
      prizeAmountCents: competition.prizeAmountCents,
      rolloverInCents: competition.rolloverInCents,
      currentPrizePoolCents: competition.prizeAmountCents + competition.rolloverInCents,
      winnerCount: competition.winnerCount,
      awardedAmountCents: competition.awardedAmountCents,
      rolloverOutCents: competition.rolloverOutCents,
      prizeSettledAt: competition.prizeSettledAt,
      entryCount: entries.length,
      opensAt: competition.opensAt,
      closesAt: competition.closesAt,
      firstGameKickoffAt: readiness.firstGameKickoffAt,
      buyInCutoffAt: readiness.firstGameKickoffAt,
      prizePoolVisible: hasFirstGameKickedOff(readiness.firstGameKickoffAt),
      teamListsReady: readiness.teamListsReady,
      readinessBlockers: readiness.blockers,
      gamesTotal: readiness.gamesTotal,
      gamesWithCompletePlayerLists: readiness.games.filter((g) => g.teamListReady).length,
      gamesMissingPlayerData: readiness.games.filter((g) => !g.teamListReady).length,
      paymentSummary,
      resultSummary,
      readiness,
      games,
      commercialEconomics,
      uniqueCustomers,
      perfectCustomers,
      payoutPerPerfectEntryCents,
      sharedSelectionSetCount,
      packageDistribution,
      correctCountDistribution,
      selectionDistribution,
    };
  });
}

export interface AdminEntrySummary {
  entryId: number;
  userEmail: string;
  userName: string | null;
  enteredAt: Date;
  paymentStatus: string;
  paidAmountCents: number | null;
  result: "pending" | "perfect" | "not_perfect";
  gamesTotal: number;
  gamesCorrect: number;
  gamesIncorrect: number;
  gamesPending: number;
  /** This entry's share of the prize pool — 0 unless it won and the competition has settled. */
  prizeAllocationCents: number;
}

export async function listAdminEntriesForCompetition(competitionId: number): Promise<DataResult<AdminEntrySummary[]>> {
  return safeQuery(async () => {
    const db = getDb();
    const entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, competitionId));
    if (entries.length === 0) return [];

    const userIds = Array.from(new Set(entries.map((e) => e.userId)));
    const [users, selections] = await Promise.all([
      db.select().from(schema.users).where(inArray(schema.users.id, userIds)),
      db.select().from(schema.entrySelections).where(inArray(schema.entrySelections.entryId, entries.map((e) => e.id))),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const selectionsByEntry = new Map<number, typeof selections>();
    for (const s of selections) {
      if (!selectionsByEntry.has(s.entryId)) selectionsByEntry.set(s.entryId, []);
      selectionsByEntry.get(s.entryId)!.push(s);
    }

    return entries.map((e) => {
      const entrySelections = selectionsByEntry.get(e.id) ?? [];
      let gamesCorrect = 0;
      let gamesIncorrect = 0;
      let gamesPending = 0;
      for (const s of entrySelections) {
        // Re-displays the already-stored per-player result(s) as one game-level state —
        // does not recompute anything against stats; the stored values are authoritative.
        const gameResult = settleGameSelection(s.selectedPlayer2Id != null ? [s.player1Result, s.player2Result!] : [s.player1Result]);
        if (gameResult === "perfect") gamesCorrect++;
        else if (gameResult === "not_perfect") gamesIncorrect++;
        else gamesPending++;
      }

      const user = userById.get(e.userId);
      return {
        entryId: e.id,
        userEmail: user?.email ?? "unknown",
        userName: user?.name ?? null,
        enteredAt: e.enteredAt,
        paymentStatus: e.paymentStatus,
        paidAmountCents: e.paidAmountCents,
        result: e.result,
        gamesTotal: entrySelections.length,
        gamesCorrect,
        gamesIncorrect,
        gamesPending,
        prizeAllocationCents: e.prizeAllocationCents,
      };
    });
  });
}

export interface AdminEntrySelectionDetail {
  gameId: number;
  homeTeamName: string;
  awayTeamName: string;
  player1Name: string;
  player1Result: SelectionResult;
  /** Null for every current (1-pick) sport — only set for a historical 2-pick entry. */
  player2Name: string | null;
  player2Result: SelectionResult | null;
  gameResult: "pending" | "perfect" | "not_perfect";
}

export interface AdminTransactionDetail {
  transactionId: number;
  provider: string;
  providerTransactionId: string | null;
  transactionType: string;
  status: string;
  amountCents: number;
  currency: string;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface AdminEntryDetail {
  entryId: number;
  sportCode: string;
  sportName: string;
  roundName: string | null;
  roundNumber: number;
  userEmail: string;
  userName: string | null;
  enteredAt: Date;
  paymentStatus: string;
  paidAmountCents: number | null;
  result: "pending" | "perfect" | "not_perfect";
  prizeAllocationCents: number;
  selections: AdminEntrySelectionDetail[];
  /** Every payment_transactions row linked to this entry (payments and any refund attempts) — read-only, no manual override control here per Phase 20. */
  transactions: AdminTransactionDetail[];
}

export async function getAdminEntryDetail(entryId: number): Promise<DataResult<AdminEntryDetail | null>> {
  return safeQuery(async () => {
    const db = getDb();
    const entryRows = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId)).limit(1);
    const entry = entryRows[0];
    if (!entry) return null;

    const [userRows, competitionRows, selections] = await Promise.all([
      db.select().from(schema.users).where(eq(schema.users.id, entry.userId)).limit(1),
      db.select().from(schema.competitions).where(eq(schema.competitions.id, entry.competitionId)).limit(1),
      db.select().from(schema.entrySelections).where(eq(schema.entrySelections.entryId, entryId)),
    ]);
    const user = userRows[0];
    const competition = competitionRows[0];
    const [sportRows, roundRows] = await Promise.all([
      competition ? db.select().from(schema.sports).where(eq(schema.sports.id, competition.sportId)).limit(1) : Promise.resolve([]),
      competition ? db.select().from(schema.rounds).where(eq(schema.rounds.id, competition.roundId)).limit(1) : Promise.resolve([]),
    ]);
    const sport = sportRows[0];
    const round = roundRows[0];

    const gameIds = selections.map((s) => s.gameId);
    const playerIds = Array.from(
      new Set(selections.flatMap((s) => [s.selectedPlayer1Id, s.selectedPlayer2Id].filter((id): id is number => id != null))),
    );
    const [games, players] = await Promise.all([
      gameIds.length ? db.select().from(schema.games).where(inArray(schema.games.id, gameIds)) : Promise.resolve([]),
      playerIds.length ? db.select().from(schema.players).where(inArray(schema.players.id, playerIds)) : Promise.resolve([]),
    ]);
    const gameById = new Map(games.map((g) => [g.id, g]));
    const playerById = new Map(players.map((p) => [p.id, p]));
    const teamIds = Array.from(new Set(games.flatMap((g) => [g.homeTeamId, g.awayTeamId])));
    const teams = teamIds.length ? await db.select().from(schema.teams).where(inArray(schema.teams.id, teamIds)) : [];
    const teamById = new Map(teams.map((t) => [t.id, t]));
    const playerName = (id: number) => {
      const p = playerById.get(id);
      return p ? `${p.firstName} ${p.lastName}` : "Unknown player";
    };

    const transactionRows = await db
      .select()
      .from(schema.paymentTransactions)
      .where(eq(schema.paymentTransactions.competitionEntryId, entryId))
      .orderBy(desc(schema.paymentTransactions.createdAt));
    const transactions: AdminTransactionDetail[] = transactionRows.map((t) => ({
      transactionId: t.id,
      provider: t.provider,
      providerTransactionId: t.providerTransactionId,
      transactionType: t.transactionType,
      status: t.status,
      amountCents: t.amountCents,
      currency: t.currency,
      failureCode: t.failureCode,
      failureMessage: t.failureMessage,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      completedAt: t.completedAt,
    }));

    const selectionDetails: AdminEntrySelectionDetail[] = selections.map((s) => {
      const game = gameById.get(s.gameId);
      const hasSecondPick = s.selectedPlayer2Id != null;
      return {
        gameId: s.gameId,
        homeTeamName: game ? (teamById.get(game.homeTeamId)?.name ?? "TBC") : "TBC",
        awayTeamName: game ? (teamById.get(game.awayTeamId)?.name ?? "TBC") : "TBC",
        player1Name: playerName(s.selectedPlayer1Id),
        player1Result: s.player1Result,
        player2Name: hasSecondPick ? playerName(s.selectedPlayer2Id!) : null,
        player2Result: hasSecondPick ? s.player2Result : null,
        gameResult: settleGameSelection(hasSecondPick ? [s.player1Result, s.player2Result!] : [s.player1Result]),
      };
    });

    return {
      entryId: entry.id,
      sportCode: sport?.code ?? "unknown",
      sportName: sport?.name ?? "Unknown sport",
      roundName: round?.name ?? null,
      roundNumber: round?.roundNumber ?? 0,
      userEmail: user?.email ?? "unknown",
      userName: user?.name ?? null,
      enteredAt: entry.enteredAt,
      paymentStatus: entry.paymentStatus,
      paidAmountCents: entry.paidAmountCents,
      result: entry.result,
      prizeAllocationCents: entry.prizeAllocationCents,
      selections: selectionDetails,
      transactions,
    };
  });
}
