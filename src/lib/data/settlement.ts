import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { decideSettleAction } from "@/lib/competitions/lifecycle";
import { getSelectionConfig } from "@/lib/perfect2/registry";
import { determineWinners, settleEntrySelections } from "@/lib/perfect2/settle";
import { settlePrizePool, type PrizeSettlementOutcome } from "@/lib/perfect2/prize";
import { pushRolloverToNextCompetitionIfExists } from "./competitions";
import { listGamesForRound } from "./games";
import { creditPrizeWinnings } from "./wallet";
import { generateMomentsForSettlement, type UserCompetitionProgress } from "./moments";
import { fireRolloverNotifications, firePrizeWonNotifications, type PrizeWonShare } from "./notifications";
import { logEvent } from "@/lib/monitoring/log";
import { safeQuery, type DataResult } from "./result";

/**
 * Competition-wide settlement orchestration. Wraps the same pure settleEntrySelections
 * core used by src/lib/data/entries.ts's getEntryWithResult (single entry) — this file
 * just fans it out across every entry in a competition and decides whether the
 * competition itself is ready to be marked "settled". The business rules themselves
 * (tries/goals >= 1, both-correct-is-perfect, etc.) live in src/lib/perfect2/settle.ts
 * and are never duplicated here. Prize-pool settlement (Phase 19) is the same extension
 * principle: the actual split math lives in src/lib/perfect2/prize.ts, this file only
 * decides *when* to run it and persists the result.
 */

export interface SettleCompetitionSummary {
  competitionId: number;
  entriesSettled: number;
  gamesTotal: number;
  gamesFinal: number;
  allGamesFinal: boolean;
  /** True if the competition's status is (now, or already was) "settled". */
  competitionSettled: boolean;
  perfectEntryIds: number[];
  /** Null until competitionSettled is true — see settlePrizePool (src/lib/perfect2/prize.ts). */
  prize: PrizeSettlementOutcome | null;
}

export type SettleCompetitionResult =
  | { status: "ok"; summary: SettleCompetitionSummary }
  | { status: "not_found" }
  | { status: "invalid"; errors: string[] }
  | { status: "unavailable"; message: string };

/**
 * Settles every entry in a competition against real, already-synced game/player stats.
 * Never fabricates a result for an unfinished game — a game with no final score simply
 * keeps every selection tied to it "pending", and the competition is only actually marked
 * "settled" once every game in its round is final. Safe to call repeatedly (idempotent):
 * already-settled selections are untouched (see settleEntrySelections' immutability
 * rule), and re-marking an already-settled competition as settled is a no-op.
 */
export async function settleCompetition(competitionId: number): Promise<SettleCompetitionResult> {
  const db = getDb();

  const competitionRows = await db.select().from(schema.competitions).where(eq(schema.competitions.id, competitionId)).limit(1);
  const competition = competitionRows[0];
  if (!competition) return { status: "not_found" };

  if (competition.status === "open") {
    return { status: "invalid", errors: ["The competition must be closed before it can be settled."] };
  }

  logEvent("settlement_started", { competitionId });

  const settleResult = await safeQuery(async () => {
    const sportRows = await db.select().from(schema.sports).where(eq(schema.sports.id, competition.sportId)).limit(1);
    const selectionConfig = getSelectionConfig(sportRows[0].code);
    const statField = selectionConfig.statField;

    const gamesResult = await listGamesForRound(competition.roundId);
    if (gamesResult.status === "unavailable") throw new Error(gamesResult.message);
    const games = gamesResult.data;
    const gameById = new Map(games.map((g) => [g.id, g]));
    const gamesFinal = games.filter((g) => g.status === "final").length;
    // A cancelled game will never become "final" — it never happened, so it can't block
    // settlement forever. A "postponed" game IS still expected to be played (rescheduled)
    // and does keep blocking until an admin either reschedules it (back to "scheduled",
    // then eventually "final" like any other game) or explicitly cancels it — see
    // src/lib/data/void.ts and docs/phase22-nba-integration.md's admin resolution process.
    const gamesSettleable = games.filter((g) => g.status === "final" || g.status === "cancelled").length;
    const allGamesFinal = games.length > 0 && gamesSettleable === games.length;

    const entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, competitionId));
    const entryIds = entries.map((e) => e.id);

    type EntrySelectionRow = typeof schema.entrySelections.$inferSelect;
    type PlayerGameStatRow = typeof schema.playerGameStats.$inferSelect;

    const [selections, stats]: [EntrySelectionRow[], PlayerGameStatRow[]] = await Promise.all([
      entryIds.length
        ? db.select().from(schema.entrySelections).where(inArray(schema.entrySelections.entryId, entryIds))
        : Promise.resolve([]),
      games.length
        ? db.select().from(schema.playerGameStats).where(inArray(schema.playerGameStats.gameId, games.map((g) => g.id)))
        : Promise.resolve([]),
    ]);
    const statByGameAndPlayer = new Map(stats.map((s) => [`${s.gameId}:${s.playerId}`, s]));
    const selectionsByEntry = new Map<number, EntrySelectionRow[]>();
    for (const s of selections) {
      if (!selectionsByEntry.has(s.entryId)) selectionsByEntry.set(s.entryId, []);
      selectionsByEntry.get(s.entryId)!.push(s);
    }

    const perfectEntryIds: number[] = [];
    // Perfect Play Moments are scoped to (userId, competitionId), never to an individual
    // entry — every entry a user holds in this competition shares an identical canonical
    // selection set (see entry-packages.ts), so overwriting this map entry-by-entry is
    // safe: whichever entry is processed last for a given user produces the exact same
    // correct/incorrect/total counts as any other of that user's entries here would.
    const progressByUser = new Map<number, UserCompetitionProgress>();

    for (const entry of entries) {
      const entrySelections = selectionsByEntry.get(entry.id) ?? [];
      const { selections: settled, entryResult } = settleEntrySelections(
        entrySelections.map((s) => ({
          gameId: s.gameId,
          selections: [
            { playerId: s.selectedPlayer1Id, storedResult: s.player1Result },
            ...(s.selectedPlayer2Id != null ? [{ playerId: s.selectedPlayer2Id, storedResult: s.player2Result ?? "pending" }] : []),
          ],
        })),
        (gameId) => gameById.get(gameId)?.status === "final",
        (gameId, playerId) => statByGameAndPlayer.get(`${gameId}:${playerId}`)?.[statField],
        selectionConfig.targetThreshold,
      );

      await Promise.all(
        entrySelections.map((s, i) => {
          const settledGame = settled[i];
          const player1Result = settledGame.selections[0]?.result ?? "pending";
          const player2Result = s.selectedPlayer2Id != null ? (settledGame.selections[1]?.result ?? "pending") : null;
          return db.update(schema.entrySelections).set({ player1Result, player2Result }).where(eq(schema.entrySelections.id, s.id));
        }),
      );
      if (entryResult !== entry.result) {
        await db.update(schema.competitionEntries).set({ result: entryResult }).where(eq(schema.competitionEntries.id, entry.id));
      }
      // A PERFECT entry only ever wins a real prize share if its own payment genuinely
      // succeeded and hasn't since been reversed — "pending" (the honest, allowed state
      // for a still-processing async payment method, see createEntry's doc comment) and
      // "paid" both remain eligible exactly as before; only failed/cancelled/refunded are
      // excluded, since real money was never (or no longer) actually received for those.
      // This never changes the entry's own computed result (still visible/auditable
      // above), only whether it can be counted as a winner in the prize-pool math below.
      const paymentDisqualified = entry.paymentStatus === "failed" || entry.paymentStatus === "cancelled" || entry.paymentStatus === "refunded";
      if (entryResult === "perfect" && !paymentDisqualified) perfectEntryIds.push(entry.id);

      progressByUser.set(entry.userId, {
        userId: entry.userId,
        competitionId,
        sportId: competition.sportId,
        sportCode: sportRows[0].code,
        totalSelections: settled.length,
        correctSelections: settled.filter((g) => g.gameResult === "perfect").length,
        incorrectSelections: settled.filter((g) => g.gameResult === "not_perfect").length,
      });
    }

    const momentsResult = await generateMomentsForSettlement(Array.from(progressByUser.values()));
    if (momentsResult.status === "unavailable") {
      logEvent("settlement_failed", { competitionId, stage: "moments", message: momentsResult.message }, "error");
    }

    // Only ever mark the competition settled once every game has actually finished —
    // never settle a competition while results are still pending. See
    // decideSettleAction (src/lib/competitions/lifecycle.ts) for the pure decision.
    const settleAction = decideSettleAction(competition.status, allGamesFinal);
    if (settleAction === "settle") {
      await db.update(schema.competitions).set({ status: "settled" }).where(eq(schema.competitions.id, competitionId));
    }
    const competitionSettled = settleAction === "settle" || competition.status === "settled";

    // --- Phase 19: prize-pool settlement. The core allocation numbers (winnerCount/
    // awardedAmountCents/rolloverOutCents) are gated on their own idempotency flag
    // (prizeSettledAt) so that UPDATE can only ever succeed once, ever, for this
    // competition — calling settle twice (or a thousand times) can never change what was
    // actually won. But everything DOWNSTREAM of that (writing each entry's
    // prizeAllocationCents, crediting the winner's wallet, pushing rollover to the next
    // competition) runs on EVERY settle call, not just the one that won the race — because
    // each of those steps is now independently, durably idempotent:
    //   - prizeAllocationCents is a deterministic overwrite (same outcome -> same value).
    //   - creditPrizeWinnings is guarded by wallet_transactions' relatedPrizeEntryId
    //     UNIQUE constraint (src/db/schema.ts) — a second attempt to credit the same entry
    //     is a safe no-op, never a double-credit, enforced by Postgres itself.
    //   - pushRolloverToNextCompetitionIfExists's tryClaimRollover (competitions.ts) now
    //     delivers to the target BEFORE claiming the source, specifically so it can be
    //     re-run safely as many times as needed.
    // This is what makes settlement genuinely recoverable: if a credit or the rollover
    // push failed the first time (a network blip, a transient DB error), simply calling
    // settle again on the same competition — the natural admin reaction to seeing a
    // failure — actually finishes the incomplete work, instead of taking a dead-end
    // "already settled, nothing more to do" branch forever.
    let prize: PrizeSettlementOutcome | null = null;
    if (competitionSettled) {
      const currentPoolCents = competition.prizeAmountCents + competition.rolloverInCents;
      const outcome = settlePrizePool(currentPoolCents, perfectEntryIds);

      let settledCompetition = competition;
      if (!competition.prizeSettledAt) {
        // Atomic idempotency gate: WHERE prize_settled_at IS NULL means only one
        // concurrent caller's UPDATE can ever match this row and decide the real
        // winnerCount/awardedAmountCents/rolloverOutCents. A loser here doesn't skip the
        // downstream work below — it just re-reads what the winner actually persisted
        // (which is deterministically identical to `outcome`, computed from the same
        // immutable inputs) and proceeds to it exactly the same as the winner does.
        const settledRows = await db
          .update(schema.competitions)
          .set({
            winnerCount: outcome.winnerCount,
            awardedAmountCents: outcome.awardedAmountCents,
            rolloverOutCents: outcome.rolloverOutCents,
            prizeSettledAt: new Date(),
          })
          .where(and(eq(schema.competitions.id, competitionId), isNull(schema.competitions.prizeSettledAt)))
          .returning();
        settledCompetition = settledRows[0] ?? (await db.select().from(schema.competitions).where(eq(schema.competitions.id, competitionId)))[0];
      }

      const userIdByEntryId = new Map(entries.map((e) => [e.id, e.userId]));
      await Promise.all(
        outcome.allocations.map((a) =>
          db.update(schema.competitionEntries).set({ prizeAllocationCents: a.amountCents }).where(eq(schema.competitionEntries.id, a.entryId)),
        ),
      );
      // Critical: writing prizeAllocationCents alone only ever updates a display/record
      // field on the entry — it never moves real money. The actual payable credit to the
      // winner's spendable Perfect Play Balance happens here. A transient failure must not
      // vanish silently: log every one loudly (with every id needed to credit it manually)
      // so it surfaces in server logs — though per the comment above, the normal recovery
      // path is simply calling settle again, which will retry exactly the entries that
      // haven't been credited yet.
      const creditResults = await Promise.all(
        outcome.allocations
          .filter((a) => a.amountCents > 0)
          .map(async (a) => {
            const userId = userIdByEntryId.get(a.entryId);
            if (!userId) return { entryId: a.entryId, amountCents: a.amountCents, userId, status: "unavailable" as const, message: "No owning user found for this entry." };
            const result = await creditPrizeWinnings(userId, a.amountCents, competitionId, a.entryId);
            return { entryId: a.entryId, amountCents: a.amountCents, userId, status: result.status, message: result.status === "unavailable" ? result.message : null };
          }),
      );
      const failedCredits = creditResults.filter((r) => r.status !== "ok");
      if (failedCredits.length > 0) {
        logEvent("settlement_failed", { competitionId, stage: "prize_credit", failedCount: failedCredits.length }, "error");
      }

      // Customer events (Feature 3): PRIZE_WON per winning customer (entries determine
      // shares, so a customer's shareCount is however many of THEIR OWN entries won —
      // never a unique-customer count), or ROLLOVER/ROLLOVER_JACKPOT to every entrant when
      // nobody won. Idempotent via dedupeKey — safe to run on every settle call, including
      // retries, exactly like the moments generation above.
      if (outcome.winnerCount > 0) {
        const sharesByUser = new Map<number, PrizeWonShare>();
        for (const a of outcome.allocations) {
          if (a.amountCents <= 0) continue;
          const userId = userIdByEntryId.get(a.entryId);
          if (!userId) continue;
          const existing = sharesByUser.get(userId);
          if (existing) {
            existing.shareCount++;
            existing.amountCents += a.amountCents;
          } else {
            sharesByUser.set(userId, { userId, shareCount: 1, amountCents: a.amountCents });
          }
        }
        const prizeWonResult = await firePrizeWonNotifications(competitionId, competition.sportId, Array.from(sharesByUser.values()));
        if (prizeWonResult.status === "unavailable") {
          logEvent("settlement_failed", { competitionId, stage: "prize_won_notification", message: prizeWonResult.message }, "error");
        }
      } else if (outcome.rolloverOutCents > 0) {
        const entrantUserIds = Array.from(new Set(entries.map((e) => e.userId)));
        const isJackpot = competition.rolloverInCents > 0;
        const rolloverNotifyResult = await fireRolloverNotifications(competitionId, competition.sportId, entrantUserIds, isJackpot);
        if (rolloverNotifyResult.status === "unavailable") {
          logEvent("settlement_failed", { competitionId, stage: "rollover_notification", message: rolloverNotifyResult.message }, "error");
        }
      }

      if (outcome.winnerCount === 0 && outcome.rolloverOutCents > 0) {
        logEvent("rollover_started", { competitionId, rolloverOutCents: outcome.rolloverOutCents });
      }
      try {
        await pushRolloverToNextCompetitionIfExists(settledCompetition);
        if (outcome.winnerCount === 0 && outcome.rolloverOutCents > 0) {
          logEvent("rollover_completed", { competitionId, rolloverOutCents: outcome.rolloverOutCents });
        }
      } catch (error) {
        logEvent("rollover_failed", { competitionId, message: error instanceof Error ? error.message : String(error) }, "error");
      }

      prize = outcome;
    }

    const summary: SettleCompetitionSummary = {
      competitionId,
      entriesSettled: entries.length,
      gamesTotal: games.length,
      gamesFinal,
      allGamesFinal,
      competitionSettled,
      perfectEntryIds,
      prize,
    };
    return summary;
  });

  if (settleResult.status === "unavailable") {
    logEvent("settlement_failed", { competitionId, message: settleResult.message }, "error");
    return settleResult;
  }
  logEvent("settlement_completed", {
    competitionId,
    entriesSettled: settleResult.data.entriesSettled,
    perfectCount: settleResult.data.perfectEntryIds.length,
    competitionSettled: settleResult.data.competitionSettled,
  });
  return { status: "ok" as const, summary: settleResult.data };
}


export interface CompetitionResultsSummary {
  competitionId: number;
  sportCode: string;
  entrantsTotal: number;
  perfectCount: number;
  pendingCount: number;
  notPerfectCount: number;
  /** Privacy-conscious identifiers only — never names/emails. See docs/phase9-10. */
  perfectEntryIds: number[];
  /** Base prize + any rollover already applied to this competition (Phase 19) — the real customer-facing pool. */
  currentPrizePoolCents: number;
  /** 0 until the competition is prize-settled. */
  awardedAmountCents: number;
  /** awardedAmountCents / perfectCount once there's at least one PERFECT entry, else null — settlement information only (see Feature 5's "acceptable to show after settlement" rule); callers must gate this behind the competition actually being settled, same as every other field here. */
  payoutPerPerfectEntryCents: number | null;
}

/**
 * Reads the competition's *currently stored* results (does not re-settle) — cheap enough
 * for a results page to call on every render. Call settleCompetition separately (e.g.
 * from a scheduler) to actually advance pending results.
 */
export async function getCompetitionResultsSummary(competitionId: number): Promise<DataResult<CompetitionResultsSummary | null>> {
  return safeQuery(async () => {
    const db = getDb();
    const competitionRows = await db.select().from(schema.competitions).where(eq(schema.competitions.id, competitionId)).limit(1);
    const competition = competitionRows[0];
    if (!competition) return null;

    const sportRows = await db.select().from(schema.sports).where(eq(schema.sports.id, competition.sportId)).limit(1);
    const entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, competitionId));

    const { winnerEntryIds, winnerCount } = determineWinners(entries);
    const pendingCount = entries.filter((e) => e.result === "pending").length;
    const notPerfectCount = entries.filter((e) => e.result === "not_perfect").length;

    return {
      competitionId,
      sportCode: sportRows[0].code,
      entrantsTotal: entries.length,
      perfectCount: winnerCount,
      pendingCount,
      notPerfectCount,
      perfectEntryIds: winnerEntryIds,
      currentPrizePoolCents: competition.prizeAmountCents + competition.rolloverInCents,
      awardedAmountCents: competition.awardedAmountCents,
      payoutPerPerfectEntryCents: winnerCount > 0 ? Math.floor(competition.awardedAmountCents / winnerCount) : null,
    };
  });
}
