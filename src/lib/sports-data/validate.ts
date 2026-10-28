import type {
  NormalizedGame,
  NormalizedGamePlayerAssociation,
  NormalizedPlayer,
  NormalizedPlayerGameStat,
  NormalizedTeam,
} from "./types";

export type SyncValidationResult = { valid: true } | { valid: false; errors: string[] };

/**
 * Data-quality checks run on normalized data before anything is written to the database.
 * These never "fix" bad data silently — a failure here should stop the sync for that
 * record and surface the error, not corrupt the database with a best guess.
 */

export function validateGame(game: NormalizedGame): SyncValidationResult {
  const errors: string[] = [];
  if (!game.externalId) errors.push("Game is missing a provider ID.");
  // roundExternalId is optional (Phase 22): a provider synced via a date range instead of
  // a native "round" concept — e.g. NBA — legitimately has none. sync.ts never reads this
  // field itself; the round a game belongs to is determined by which round the caller
  // asked to sync into, not by this descriptive string.
  if (!game.homeTeamExternalId || !game.awayTeamExternalId) {
    errors.push(`Game ${game.externalId} does not have two teams (home and away required).`);
  }
  if (game.homeTeamExternalId && game.homeTeamExternalId === game.awayTeamExternalId) {
    errors.push(`Game ${game.externalId} has the same team as both home and away.`);
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export function validatePlayer(player: NormalizedPlayer): SyncValidationResult {
  const errors: string[] = [];
  if (!player.externalId) errors.push("Player is missing a provider ID.");
  if (!player.firstName || !player.lastName) errors.push(`Player ${player.externalId} is missing a name.`);
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export function validateGamePlayerAssociation(
  association: NormalizedGamePlayerAssociation,
): SyncValidationResult {
  const errors: string[] = [];
  if (!association.gameExternalId) errors.push("Game-player association is missing a game ID.");
  if (!association.playerExternalId) errors.push("Game-player association is missing a player ID.");
  if (!association.teamExternalId) {
    errors.push(`Player ${association.playerExternalId} in game ${association.gameExternalId} is missing a team ID.`);
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export function validatePlayerGameStat(stat: NormalizedPlayerGameStat): SyncValidationResult {
  const errors: string[] = [];
  if (!Number.isFinite(stat.statCount) || stat.statCount < 0) {
    errors.push(
      `Invalid ${stat.statField} count (${stat.statCount}) for player ${stat.playerExternalId} in game ${stat.gameExternalId}.`,
    );
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/** Detects duplicate provider IDs within one batch — a red flag the provider payload is corrupt. */
export function findDuplicateExternalIds(items: readonly { externalId: string }[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    if (seen.has(item.externalId)) duplicates.add(item.externalId);
    seen.add(item.externalId);
  }
  return Array.from(duplicates);
}

/** Detects a player appearing twice in the same game's association list. */
export function findDuplicateGamePlayerAssociations(
  associations: readonly NormalizedGamePlayerAssociation[],
): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const a of associations) {
    const key = `${a.gameExternalId}:${a.playerExternalId}`;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return Array.from(duplicates);
}

export function validateTeam(team: NormalizedTeam): SyncValidationResult {
  const errors: string[] = [];
  if (!team.externalId) errors.push("Team is missing a provider ID.");
  if (!team.name) errors.push(`Team ${team.externalId} is missing a name.`);
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
