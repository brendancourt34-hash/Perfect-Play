import type { SportSelectionConfig } from "../types";

/**
 * NRL Perfect Play selection rule: pick 1 try scorer per game (any player from either
 * team, no position restriction). A pick is correct if that player scores at least 1 try.
 */
export const nrlSelectionConfig: SportSelectionConfig = {
  sportCode: "nrl",
  statField: "tries",
  targetThreshold: 1,
  selectionLabel: "Try Scorer",
  selectionsPerGame: 1,
  oneRemainingLabel: "PICK",
};
