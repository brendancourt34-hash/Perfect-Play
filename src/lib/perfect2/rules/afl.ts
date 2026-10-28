import type { SportSelectionConfig } from "../types";

/**
 * AFL Perfect Play selection rule: pick 1 goal scorer per game (any player from either
 * team, no position restriction). A pick is correct if that player kicks at least 1 goal.
 * Round shape (9 games/round) is configured separately — see ../round-shape.ts.
 */
export const aflSelectionConfig: SportSelectionConfig = {
  sportCode: "afl",
  statField: "goals",
  targetThreshold: 1,
  selectionLabel: "Goal Scorer",
  selectionsPerGame: 1,
  oneRemainingLabel: "PICK",
};
