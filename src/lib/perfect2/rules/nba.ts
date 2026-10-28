import type { SportSelectionConfig } from "../types";

/**
 * NBA Perfect Play selection rule (Phase 23F): pick 1 player per game (any player from
 * either team, no position/starting-lineup restriction). A pick is correct if that player
 * scores 25+ points (24 or fewer is a miss). Threshold raised from the original Phase 22
 * value of 20 to 25 as part of the Phase 23F rules update.
 */
export const nbaSelectionConfig: SportSelectionConfig = {
  sportCode: "nba",
  statField: "points",
  targetThreshold: 25,
  selectionLabel: "25+ Points",
  selectionsPerGame: 1,
  oneRemainingLabel: "GAME",
};
