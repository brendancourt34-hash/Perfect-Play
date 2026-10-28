import type { EntryResult, GameSelectionResult, SelectionResult } from "./types";

/**
 * Settles a single player selection against their actual stat count for the game.
 * Pending until the game is final — never guessed early. A missing stat row when the
 * game is final counts as 0 (i.e. incorrect), since "no row" means they didn't record
 * the stat, not that the data is unavailable (see the data layer for that distinction).
 *
 * `threshold` is the sport's configured minimum (see SportSelectionConfig.targetThreshold
 * — 1 for NRL tries / AFL goals / NFL touchdowns, 25 for NBA points), always >=, never >.
 * Defaults to 1 so every existing call site/test that doesn't pass one keeps its exact
 * prior behavior.
 */
export function settleSelection(statCount: number | null | undefined, gameIsFinal: boolean, threshold: number = 1): SelectionResult {
  if (!gameIsFinal) return "pending";
  return (statCount ?? 0) >= threshold ? "correct" : "incorrect";
}

/**
 * Settles a game's pick outcome from however many selections it actually has — 1 for
 * every sport since Phase 23F ("pick the perfect round"), 2 for a historical entry
 * created before then. Perfect only if every one is correct; not_perfect as soon as any
 * is known incorrect; pending otherwise. Never hard-codes "2" — an empty array (a game
 * with no selections at all) settles as pending, matching settleEntry's own empty-input
 * behavior, and is not expected to occur in practice (every game in a round always has at
 * least one selection per entry).
 */
export function settleGameSelection(results: readonly SelectionResult[]): GameSelectionResult {
  if (results.length === 0) return "pending";
  if (results.some((r) => r === "incorrect")) return "not_perfect";
  if (results.some((r) => r === "pending")) return "pending";
  return "perfect";
}

/**
 * Settles an entry's overall result across every game in its round. A single
 * not_perfect game ends the entry immediately, regardless of other games still
 * pending — this is not points accumulation, it's "get every pick right or you're out."
 */
export function settleEntry(gameResults: GameSelectionResult[]): EntryResult {
  if (gameResults.length === 0) return "pending";
  if (gameResults.some((r) => r === "not_perfect")) return "not_perfect";
  if (gameResults.some((r) => r === "pending")) return "pending";
  return "perfect";
}

/** One selection slot's stored state within a game — playerId is never null; a slot that doesn't exist for this game is simply omitted from the array, not represented as a null entry. */
export interface PlayerSelectionSettlementInput {
  playerId: number;
  storedResult: SelectionResult;
}

export interface PlayerSelectionSettlementOutput {
  playerId: number;
  result: SelectionResult;
}

/**
 * One game's worth of selection inputs for bulk/whole-entry settlement — `selections` has
 * length 1 for every sport since Phase 23F, or length 2 for a historical entry created
 * under the old model. The engine never assumes a fixed count.
 */
export interface SelectionSettlementInput {
  gameId: number;
  selections: PlayerSelectionSettlementInput[];
}

export interface SelectionSettlementOutput {
  gameId: number;
  selections: PlayerSelectionSettlementOutput[];
  gameResult: GameSelectionResult;
}

export interface EntrySettlementResult {
  selections: SelectionSettlementOutput[];
  entryResult: EntryResult;
}

/**
 * Settles every selection in an entry (or a whole competition's worth of entries, one
 * call per entry) and rolls them up into the overall entry result. This is the single
 * shared core used by both "read one entry's live result" (src/lib/data/entries.ts) and
 * "settle every entry in a competition" (src/lib/data/settlement.ts), so the immutability
 * rule and roll-up logic exist in exactly one place.
 *
 * Immutability: a selection whose *stored* result is already "correct" or "incorrect" is
 * never recomputed, even if `getStat` would now return a different value — see
 * docs/stage8 and docs/phase9-10 for why (a later provider correction to an already-final
 * game must not silently flip an already-settled entry).
 */
export function settleEntrySelections(
  games: readonly SelectionSettlementInput[],
  isGameFinal: (gameId: number) => boolean,
  getStat: (gameId: number, playerId: number) => number | null | undefined,
  threshold: number = 1,
): EntrySettlementResult {
  const settled: SelectionSettlementOutput[] = games.map((g) => {
    const isFinal = isGameFinal(g.gameId);
    const selections = g.selections.map((s) => ({
      playerId: s.playerId,
      result: s.storedResult !== "pending" ? s.storedResult : settleSelection(getStat(g.gameId, s.playerId), isFinal, threshold),
    }));
    return {
      gameId: g.gameId,
      selections,
      gameResult: settleGameSelection(selections.map((s) => s.result)),
    };
  });

  return { selections: settled, entryResult: settleEntry(settled.map((s) => s.gameResult)) };
}

export interface WinnerDeterminationResult {
  winnerEntryIds: number[];
  winnerCount: number;
}

/**
 * A winner is simply any entry whose result is "perfect" — no ranking, no tie-break, no
 * points. Zero perfect entries means no winner; more than one means multiple winners,
 * all equally winners. Deliberately does not sort, score, or rank the returned IDs.
 */
export function determineWinners(entries: readonly { id: number; result: EntryResult }[]): WinnerDeterminationResult {
  const winnerEntryIds = entries.filter((e) => e.result === "perfect").map((e) => e.id);
  return { winnerEntryIds, winnerCount: winnerEntryIds.length };
}
