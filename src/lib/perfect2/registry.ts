import { nrlSelectionConfig } from "./rules/nrl";
import { aflSelectionConfig } from "./rules/afl";
import { nbaSelectionConfig } from "./rules/nba";
import { nflSelectionConfig } from "./rules/nfl";
import type { SportSelectionConfig } from "./types";

const CONFIGS: Record<string, SportSelectionConfig> = {
  nrl: nrlSelectionConfig,
  afl: aflSelectionConfig,
  nba: nbaSelectionConfig,
  nfl: nflSelectionConfig,
};

/** Look up the Perfect Play selection config for a sport by its code (e.g. "nrl", "afl"). */
export function getSelectionConfig(sportCode: string): SportSelectionConfig {
  const config = CONFIGS[sportCode];
  if (!config) {
    throw new Error(`No Perfect Play selection config registered for sport "${sportCode}".`);
  }
  return config;
}
