import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { safeQuery, type DataResult } from "./result";

/**
 * Admin-only resolution for real-world exceptions Perfect Play cannot honestly settle
 * (Phase 22 §20/21): a postponed/cancelled game, or a specific player who was ruled out
 * and never played. Never invents a result — every affected selection is marked "void"
 * (see src/lib/perfect2/settle.ts, which treats void as never blocking a "perfect"
 * outcome — the current, documented, deliberately changeable resolution rule) rather than
 * being guessed as correct/incorrect. Only ever touches a selection that's still
 * "pending" — an already-settled correct/incorrect selection is immutable, exactly like
 * everywhere else in this engine.
 */

export interface VoidGameResult {
  gameStatusUpdated: boolean;
  selectionsVoided: number;
}

/**
 * Voids every still-"pending" selection referencing this game, across every entry — the
 * shared core of a "this game will never produce a real result" decision. Used by
 * voidGame (an explicit admin action) AND by the sports-data sync path
 * (src/lib/sports-data/sync.ts) when a provider resync reports a game has transitioned to
 * "cancelled" on its own — without this, an auto-cancelled game's selections would sit at
 * "pending" forever (isGameFinal only ever treats "final" as settleable-per-selection),
 * permanently stranding the entries that picked it with no way to ever resolve, even
 * though the competition itself is free to be marked settled around them.
 */
export async function voidPendingSelectionsForGame(gameId: number): Promise<number> {
  const db = getDb();
  const selections = await db.select().from(schema.entrySelections).where(eq(schema.entrySelections.gameId, gameId));
  let selectionsVoided = 0;
  for (const s of selections) {
    const player1Result = s.player1Result === "pending" ? "void" : s.player1Result;
    const player2Result = s.player2Result === "pending" ? "void" : s.player2Result;
    if (player1Result !== s.player1Result || player2Result !== s.player2Result) {
      await db.update(schema.entrySelections).set({ player1Result, player2Result }).where(eq(schema.entrySelections.id, s.id));
      selectionsVoided++;
    }
  }
  return selectionsVoided;
}

/**
 * Marks a game "cancelled" (idempotent — a no-op status update if already cancelled) and
 * voids every pending selection referencing it, across every entry. Use this for a real
 * cancellation/no-replay decision — a merely "postponed" (expected to be rescheduled)
 * game should NOT be voided; update its kickoff and leave it "scheduled" instead once a
 * new time is confirmed.
 */
export async function voidGame(gameId: number, _reason: string): Promise<DataResult<VoidGameResult>> {
  return safeQuery(async () => {
    const db = getDb();
    const gameRows = await db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
    const game = gameRows[0];
    if (!game) throw new Error(`Game ${gameId} not found.`);

    const gameStatusUpdated = game.status !== "cancelled";
    if (gameStatusUpdated) {
      await db.update(schema.games).set({ status: "cancelled" }).where(eq(schema.games.id, gameId));
    }

    const selectionsVoided = await voidPendingSelectionsForGame(gameId);
    return { gameStatusUpdated, selectionsVoided };
  });
}

/**
 * Voids ONE selection's one player slot for ONE entry — the game still goes ahead, but
 * this specific selected player individually never played (scratched pre-tip). Other
 * entries who picked different players for the same game are entirely unaffected.
 */
export async function voidPlayerSelection(
  entrySelectionId: number,
  side: "player1" | "player2",
  _reason: string,
): Promise<DataResult<{ voided: boolean }>> {
  return safeQuery(async () => {
    const db = getDb();
    const rows = await db.select().from(schema.entrySelections).where(eq(schema.entrySelections.id, entrySelectionId)).limit(1);
    const selection = rows[0];
    if (!selection) throw new Error(`Selection ${entrySelectionId} not found.`);

    const currentResult = side === "player1" ? selection.player1Result : selection.player2Result;
    if (currentResult !== "pending") return { voided: false }; // already settled/voided — immutable, no-op

    await db
      .update(schema.entrySelections)
      .set(side === "player1" ? { player1Result: "void" } : { player2Result: "void" })
      .where(eq(schema.entrySelections.id, entrySelectionId));
    return { voided: true };
  });
}
