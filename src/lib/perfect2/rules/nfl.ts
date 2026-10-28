import type { SportSelectionConfig } from "../types";

/**
 * NFL Perfect Play selection rule (Phase 23F — new sport): pick 1 touchdown scorer per
 * game (any player from either team, no position restriction). A pick is correct if that
 * player scores at least 1 touchdown. Round shape (8 selected games/round) is configured
 * separately — see ../round-shape.ts. The sports-data provider for NFL is currently
 * unconfigured (see src/lib/sports-data/config.ts) — this rule config is real and usable
 * as soon as real game/stat data exists, exactly like NRL/AFL were before Champion Data.
 */
export const nflSelectionConfig: SportSelectionConfig = {
  sportCode: "nfl",
  statField: "touchdowns",
  targetThreshold: 1,
  selectionLabel: "Touchdown Scorer",
  selectionsPerGame: 1,
  oneRemainingLabel: "GAME",
};
