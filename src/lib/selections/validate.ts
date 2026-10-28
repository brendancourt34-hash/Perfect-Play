/**
 * Validation for a user's Perfect Play selections. Deliberately has no notion of position,
 * "winger", or any other eligibility rule beyond "is this player actually part of this
 * game" — eligibility comes entirely from the real sports-data lineup (game_lineups),
 * never invented here.
 */

export interface SelectionInput {
  gameId: number;
  /** One player id per required selection for this sport — length 1 for every sport since Phase 23F ("pick the perfect round"); a historical 2-per-game entry would have length 2. */
  playerIds: (number | null | undefined)[];
}

export type ValidationResult = { valid: true } | { valid: false; errors: string[] };

/**
 * Validates one game's selection(s) against the set of players actually eligible for
 * that game (i.e. present in game_lineups for either team, any position), and against
 * the sport's required selection count (see SportSelectionConfig.selectionsPerGame).
 */
export function validateSelection(input: SelectionInput, eligiblePlayerIds: ReadonlySet<number>, selectionsPerGame: number): ValidationResult {
  const errors: string[] = [];

  if (input.playerIds.length !== selectionsPerGame || input.playerIds.some((id) => id == null)) {
    errors.push(
      selectionsPerGame === 1
        ? "Exactly 1 player must be selected for this game."
        : `Exactly ${selectionsPerGame} players must be selected for this game.`,
    );
    return { valid: false, errors };
  }

  const playerIds = input.playerIds as number[];
  if (new Set(playerIds).size !== playerIds.length) {
    errors.push("The selected players for this game must all be different.");
  }

  playerIds.forEach((id, i) => {
    if (!eligiblePlayerIds.has(id)) {
      errors.push(selectionsPerGame === 1 ? "Selected player is not eligible for this game." : `Selected player ${i + 1} is not eligible for this game.`);
    }
  });

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * Validates a full entry's selections against the games in its round: every game in
 * the round must have exactly one selection, and no selection may reference a game
 * outside the round.
 */
export function validateEntrySelections(
  roundGameIds: readonly number[],
  selections: readonly SelectionInput[],
): ValidationResult {
  const errors: string[] = [];
  const roundGameIdSet = new Set(roundGameIds);
  const selectedGameIds = new Set(selections.map((s) => s.gameId));

  for (const selection of selections) {
    if (!roundGameIdSet.has(selection.gameId)) {
      errors.push(`Game ${selection.gameId} is not part of this round.`);
    }
  }

  for (const gameId of roundGameIds) {
    if (!selectedGameIds.has(gameId)) {
      errors.push(`Missing selection for game ${gameId}.`);
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export interface LockCheckGame {
  status: "scheduled" | "live" | "final" | "postponed" | "cancelled";
  kickoff: Date | string | null;
}

/**
 * A game's selections are locked once it's no longer scheduled, or kickoff has passed.
 * A postponed/cancelled game is correctly locked too (never "scheduled") — Perfect Play
 * never accepts new picks against a game that isn't actually going ahead as planned; see
 * the void-selection resolution process (src/lib/data/void.ts) for existing entries.
 */
export function isSelectionLocked(game: LockCheckGame, now: Date = new Date()): boolean {
  if (game.status !== "scheduled") return true;
  if (!game.kickoff) return false;
  const kickoff = typeof game.kickoff === "string" ? new Date(game.kickoff) : game.kickoff;
  return kickoff.getTime() <= now.getTime();
}
