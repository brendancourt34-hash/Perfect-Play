/**
 * Normalized sports-data model. This is the shape every provider adapter must translate
 * external data into — nothing downstream of this file (sync, validation, the database,
 * competitions/selections/settlement) ever speaks a provider's native format directly.
 *
 *   External Provider → Provider Adapter → (these types) → sync.ts → Postgres
 *
 * Deliberately minimal: Perfect Play only needs enough to populate games, who played in them,
 * and their try/goal count. This is not a general-purpose fantasy-stats model — see
 * docs/stage8-sports-data-integration.md for the reasoning.
 */

/** Internal match-status vocabulary. Providers map their own statuses onto this — see status.ts. */
export type NormalizedGameStatus = "scheduled" | "live" | "final" | "postponed" | "cancelled";

export interface NormalizedSeason {
  /** Stable ID from the provider — the idempotent sync key. */
  externalId: string;
  sportCode: string;
  year: number;
  label: string;
}

export interface NormalizedRound {
  externalId: string;
  seasonExternalId: string;
  roundNumber: number;
  name?: string;
  startDate?: string; // ISO date
  endDate?: string; // ISO date
}

export interface NormalizedTeam {
  externalId: string;
  sportCode: string;
  name: string;
  shortName: string;
  logoUrl?: string;
}

export interface NormalizedGame {
  externalId: string;
  /**
   * Optional since Phase 22: a provider synced via listGamesByDateRange (no natural
   * upstream "round" concept — see provider.ts) has no round to name. Never read by
   * sync.ts's upsert logic either way — the provider itself is trusted to have already
   * filtered to the games it was asked for.
   */
  roundExternalId?: string;
  homeTeamExternalId: string;
  awayTeamExternalId: string;
  /** ISO datetime, or undefined if not yet scheduled. */
  kickoff?: string;
  venue?: string;
  status: NormalizedGameStatus;
  homeScore?: number;
  awayScore?: number;
}

export interface NormalizedPlayer {
  externalId: string;
  sportCode: string;
  firstName: string;
  lastName: string;
  /** Informational only — see the module doc. Never used to restrict Perfect Play selection. */
  position?: string;
  teamExternalId?: string;
  photoUrl?: string;
}

/**
 * Ties a player to a specific game — this is the entire eligibility pool for that game's
 * Perfect Play selections. No position/starting-status filtering happens here or anywhere
 * downstream; every player associated with a game is equally selectable.
 */
/**
 * Real provider-reported injury designations only — never a status we invented. `OUT` is
 * the one value treated as a hard eligibility exclusion (src/lib/data/games.ts); every
 * other value is informational (a warning badge in the picker), since a Day-To-Day/
 * Doubtful/Questionable/Probable player may still legitimately play.
 */
export type InjuryStatus = "OUT" | "DOUBTFUL" | "QUESTIONABLE" | "DAY_TO_DAY" | "PROBABLE";

export interface NormalizedGamePlayerAssociation {
  gameExternalId: string;
  playerExternalId: string;
  teamExternalId: string;
  /** Informational only, e.g. for display in the selection UI. Never gates eligibility. */
  position?: string;
  /** Omit rather than fabricate: only set this when the provider actually reports a real starting-lineup signal (none currently do pre-game — see nba-espn-provider.ts). */
  isStarting?: boolean;
  /** Null/omitted when the provider reports no injury designation for this player right now. */
  injuryStatus?: InjuryStatus | null;
}

/**
 * The single stat Perfect Play actually needs per player per game: tries for NRL, goals for
 * AFL (see src/lib/perfect2/registry.ts). `statCount` should be omitted (not zero) while
 * the match is still in progress and the provider hasn't finalized it — the settlement
 * engine already treats "no stat row yet" as pending until the game is final, so don't
 * synthesize a 0 to fill the gap.
 */
export interface NormalizedPlayerGameStat {
  gameExternalId: string;
  playerExternalId: string;
  teamExternalId: string;
  statField: "tries" | "goals" | "points" | "touchdowns";
  statCount: number;
}
