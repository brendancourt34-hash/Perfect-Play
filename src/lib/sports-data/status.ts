import type { NormalizedGameStatus } from "./types";

/**
 * Maps an external provider's own status vocabulary onto Perfect Play's 3-value internal
 * status (scheduled/live/final). Every provider adapter supplies its own mapping table —
 * this function never invents a mapping for a status it doesn't recognise; it fails loudly
 * instead, per the "do not silently corrupt data" requirement.
 */
export function mapExternalGameStatus(
  externalStatus: string,
  mapping: Record<string, NormalizedGameStatus>,
): NormalizedGameStatus {
  const mapped = mapping[externalStatus];
  if (!mapped) {
    throw new Error(
      `Unrecognised external game status "${externalStatus}" — add it to the provider's status mapping table rather than guessing.`,
    );
  }
  return mapped;
}
