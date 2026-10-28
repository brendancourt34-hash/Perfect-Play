import type { CompetitionStatus } from "@/db/schema";

/**
 * The competition lifecycle. The database only ever stores 3 explicit states
 * (open/closed/settled — schema.competitionStatusValues) — no new DB state is
 * introduced here. "not_yet_open" is a *derived* condition layered on top of the stored
 * `open` status plus `opensAt`, used only to decide what the UI/server should currently
 * permit; it is never written back to the database.
 *
 * Rule (deterministic, explicit status always wins over timing):
 *   status = "settled"                          → "settled"
 *   status = "closed"                            → "closed"
 *   status = "open" and now < opensAt             → "not_yet_open"
 *   status = "open" and closesAt <= now           → "closed"  (time has passed; entries
 *                                                    stop being accepted even before a
 *                                                    scheduler/admin has flipped the
 *                                                    stored status — see closeCompetition)
 *   status = "open" otherwise                     → "open"
 *
 * All comparisons use plain `Date`/UTC — no timezone is assumed or hard-coded anywhere in
 * this file. `opensAt`/`closesAt` are stored as `timestamptz` in Postgres and always
 * round-trip as UTC-aware `Date` objects; any Australian-timezone *display* formatting
 * happens only in the UI layer (src/lib/utils/format.ts), never here.
 */
export type EffectiveCompetitionState = "not_yet_open" | "open" | "closed" | "settled";

export interface CompetitionTiming {
  status: CompetitionStatus;
  opensAt: Date | null;
  closesAt: Date | null;
}

export function getEffectiveCompetitionState(
  competition: CompetitionTiming,
  now: Date = new Date(),
): EffectiveCompetitionState {
  if (competition.status === "settled") return "settled";
  if (competition.status === "closed") return "closed";

  // status === "open" from here — apply timing on top of it.
  if (competition.opensAt && now.getTime() < competition.opensAt.getTime()) return "not_yet_open";
  if (competition.closesAt && now.getTime() >= competition.closesAt.getTime()) return "closed";
  return "open";
}

/** Whether a brand-new entry may be created right now. */
export function canAcceptEntries(competition: CompetitionTiming, now: Date = new Date()): boolean {
  return getEffectiveCompetitionState(competition, now) === "open";
}

/**
 * The pure decision behind closeCompetition (src/lib/data/competitions.ts): closing is
 * idempotent by construction — an already-closed or already-settled competition is left
 * exactly as it is, never regressed or double-transitioned. Extracted as a pure function
 * so this specific "safe to call twice" guarantee is directly unit-testable without a
 * database.
 */
export function decideCloseAction(currentStatus: CompetitionStatus): "close" | "noop" {
  return currentStatus === "open" ? "close" : "noop";
}

/**
 * The pure decision behind settleCompetition: a competition may only ever move to
 * "settled" once every game in its round is final — never while results are still
 * pending. Also a no-op if it's already settled.
 */
export function decideSettleAction(currentStatus: CompetitionStatus, allGamesFinal: boolean): "settle" | "noop" | "not_ready" {
  if (currentStatus === "settled") return "noop";
  if (currentStatus === "open") return "not_ready"; // must be closed first
  return allGamesFinal ? "settle" : "not_ready";
}

/**
 * Phase 21 — the single, canonical definition of "the first game of the round": the
 * earliest kickoff timestamp among the round's games. This is the authoritative buy-in
 * cutoff (see docs/phase21-sports-data-and-round-lifecycle.md) and the moment the prize
 * pool becomes publicly visible — every place that needs either value must compute it
 * through this function, never by re-deriving it inline (array order, a client-supplied
 * value, or any other approximation).
 *
 * Games with no kickoff yet (not scheduled) are ignored, not treated as "already
 * started" or as a tie-breaker. If two games share the identical kickoff instant, MIN()
 * is still perfectly well-defined — the cutoff is a point in time, not a reference to
 * "which game," so an exact tie changes nothing about the comparison below. Returns null
 * only when no game in the round has a known kickoff yet (round not yet schedulable).
 *
 * All comparisons are plain `Date`/UTC — timestamps are stored as `timestamptz` and
 * always round-trip UTC-aware, so there is nothing timezone-dependent to get wrong here;
 * Australian-timezone formatting happens only in the UI layer, never in this comparison.
 */
export function computeFirstGameKickoff(games: readonly { kickoff: Date | null }[]): Date | null {
  let earliest: Date | null = null;
  for (const game of games) {
    if (!game.kickoff) continue;
    if (!earliest || game.kickoff.getTime() < earliest.getTime()) earliest = game.kickoff;
  }
  return earliest;
}

/**
 * Whether the round's first game has kicked off as of `now` — the single source of truth
 * for "buy-in is closed" and "the prize pool is now public" (both trigger at exactly the
 * same instant, per the Phase 21 product rule). A round with no known kickoff yet has not
 * kicked off. Uses `>=`: at the exact kickoff instant, the round is already considered
 * kicked off (matches isSelectionLocked's existing `<=` lock semantics in
 * src/lib/selections/validate.ts, and getEffectiveCompetitionState's existing
 * `now >= closesAt` semantics — all three treat the boundary instant identically).
 */
export function hasFirstGameKickedOff(firstGameKickoff: Date | null, now: Date = new Date()): boolean {
  if (!firstGameKickoff) return false;
  return now.getTime() >= firstGameKickoff.getTime();
}
