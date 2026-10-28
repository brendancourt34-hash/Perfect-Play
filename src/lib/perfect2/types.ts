/**
 * Perfect Play settlement engine — shared types.
 *
 * Perfect Play is "pick the perfect round": for a paid entry, a user picks
 * `selectionsPerGame` players per game (any players eligible for that game — never
 * restricted by position; every current sport uses exactly 1), and each selection is
 * settled against that sport's single required stat, compared to that sport's configured
 * target (tries >=1 for NRL, goals >=1 for AFL, points >=25 for NBA, touchdowns >=1 for
 * NFL — see SportSelectionConfig.targetThreshold). There is no points-scoring/leaderboard
 * system anywhere in this engine — "points" here only ever means the NBA in-game box-score
 * stat being compared against a threshold, exactly like tries/goals/touchdowns; every
 * outcome is still one of the tri-state values below (plus the admin-only "void"
 * exception).
 *
 * Historical note: entries created before Phase 23F used a fixed 2-selections-per-game
 * model. Those rows are never reinterpreted — settle.ts's per-game settlement operates
 * over however many selections a game actually has, so a 2-selection historical game and
 * a 1-selection current game both settle correctly through the same code path.
 */

/**
 * A single player's pick outcome. "pending" until the game is final. "void" is never
 * produced by settlement itself — it exists only for an explicit admin resolution (a
 * player who didn't play, or a cancelled game) and, once set, is immutable exactly like
 * "correct"/"incorrect" — see src/lib/data/void.ts and settleEntrySelections' immutability
 * rule below. A "void" selection never causes an entry to fail (settleGameSelection only
 * ever fails a game on "incorrect" — "void" and "correct" both leave it able to be
 * "perfect"), which is the current (documented, deliberately changeable) resolution rule.
 */
export type SelectionResult = "pending" | "correct" | "incorrect" | "void";

/** A game's pick outcome, derived from all of its selections — "perfect" only if every one is correct. */
export type GameSelectionResult = "pending" | "perfect" | "not_perfect";

/** An entry's overall outcome across every game in the round — "perfect" only if every game is. */
export type EntryResult = "pending" | "perfect" | "not_perfect";

/** The actual per-player stat count needed to settle a selection for one game. */
export interface PlayerGameStatLine {
  playerId: number;
  /** Count of the sport's required stat for this game (tries for NRL, goals for AFL). */
  statCount: number;
}

/**
 * Per-sport configuration for the settlement engine. Each sport defines only which stat
 * counts as "correct" and how selections are labelled — there is no position-based
 * eligibility logic here or anywhere else in Perfect Play's selection model.
 */
export interface SportSelectionConfig {
  sportCode: string;
  /** Which stat on player_game_stats determines a correct pick. */
  statField: "tries" | "goals" | "points" | "touchdowns";
  /**
   * The minimum stat count for a "correct" pick (>=, never >). 1 for NRL tries / AFL
   * goals / NFL touchdowns; 25 for NBA points. Never hardcoded in settle.ts itself — see
   * src/lib/perfect2/settle.ts's settleSelection.
   */
  targetThreshold: number;
  /** e.g. "Try Scorer" / "Goal Kicker" / "25+ Points" / "Touchdown Scorer" — labels the selection slot(s) in the UI. */
  selectionLabel: string;
  /**
   * How many players a user picks per game for this sport. Every sport configured since
   * Phase 23F uses 1 ("pick the perfect round" — one selection per game). Historical
   * entries created under the old 2-per-game model are settled by the same engine
   * (settle.ts derives the expected count from however many selection rows a game
   * actually has), so this field only governs NEW entry creation/validation — see
   * src/lib/selections/validate.ts.
   */
  selectionsPerGame: number;
  /**
   * The noun used in Perfect Play Moments' "one remaining" copy — "X/X PERFECT — ONE
   * PICK LEFT" for NRL/AFL vs "X/X PERFECT — ONE GAME LEFT" for NBA/NFL (see the Perfect
   * Play Moments product spec). Purely a display label; never affects settlement.
   */
  oneRemainingLabel: "PICK" | "GAME";
}
