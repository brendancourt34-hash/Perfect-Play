/**
 * Perfect Play Moments — the emotional progression engine for an in-progress entry.
 *
 * Pure functions only (no I/O), same style as settle.ts/prize.ts. Sport-agnostic: takes
 * only correct/incorrect/total counts and a per-sport "one remaining" noun
 * (SportSelectionConfig.oneRemainingLabel) — it never hard-codes a sport's total game
 * count (8 for NRL/NBA/NFL, 9 for AFL). See src/lib/data/moments.ts for the
 * idempotent-persistence layer built on top of this, and settlement.ts for where it's
 * actually invoked (once per settle pass, per user, off the user's ONE shared canonical
 * selection set — never once per individual entry, so a customer holding 10 identical
 * entries gets exactly one moment, not ten).
 *
 * Deliberately NOT one moment per settled game — "do not spam customers" (product spec).
 * Milestones fire at fixed correct-pick counts (3, then 5) rather than every correct pick,
 * plus the two narrative beats every entry always has exactly one of: "one selection left"
 * and the terminal outcome (PERFECT, or PERFECT ENDS HERE on the first incorrect pick).
 */

export type MomentType = "pick_correct_milestone" | "one_left" | "perfect" | "perfect_ended";

export interface SelectionProgress {
  /** Total selections in this entry's round (8 for NRL/NBA/NFL, 9 for AFL — never hard-coded here). */
  totalSelections: number;
  /** Games/selections already settled correct — monotonically non-decreasing across a round. */
  correctSelections: number;
  /** Games/selections already settled incorrect. Perfect Play has no partial credit: even one incorrect selection ends the entry's PERFECT run immediately (see settle.ts's settleEntry). */
  incorrectSelections: number;
}

export interface MomentCandidate {
  type: MomentType;
  message: string;
}

/** Fixed milestone thresholds (correct-pick counts) — deliberately sparse per the "don't spam" product requirement. Both must be reachable only when there's still at least one game to go (checked in computeMoment via the "one_left"/"perfect" precedence below). */
const MILESTONE_THRESHOLDS = [3, 5] as const;

/**
 * Computes the single highest-priority moment (if any) implied by an entry's current
 * progress. Callers are expected to only persist a NEW moment when it hasn't already been
 * recorded for this exact state (see src/lib/data/moments.ts's dedupe-key + terminal-state
 * short-circuit) — this function itself is stateless and always recomputes fresh, since
 * "have I already sent this" is a persistence concern, not a progression-math concern.
 *
 * Precedence (highest first): PERFECT_ENDED (any incorrect pick, ever — a terminal state)
 * > PERFECT (every selection correct — the other terminal state) > ONE_LEFT (exactly one
 * selection remains, still a clean run) > milestone (a configured correct-count reached,
 * with at least 2 selections still to go — once only one remains, ONE_LEFT already covers
 * that beat instead).
 */
export function computeMoment(progress: SelectionProgress, oneRemainingLabel: "PICK" | "GAME"): MomentCandidate | null {
  const { totalSelections, correctSelections, incorrectSelections } = progress;
  if (totalSelections <= 0) return null;
  const remaining = totalSelections - correctSelections - incorrectSelections;

  if (incorrectSelections > 0) {
    return { type: "perfect_ended", message: `PERFECT ENDS HERE — ${correctSelections}/${totalSelections}` };
  }
  if (remaining === 0) {
    // No incorrect picks and nothing left pending: every selection was correct.
    return { type: "perfect", message: "YOU WENT PERFECT — ALL PICKS CORRECT" };
  }
  if (remaining === 1) {
    return { type: "one_left", message: `${correctSelections}/${totalSelections} PERFECT — ONE ${oneRemainingLabel} LEFT` };
  }
  if ((MILESTONE_THRESHOLDS as readonly number[]).includes(correctSelections)) {
    const label = correctSelections >= 5 ? "STILL PERFECT" : "ANOTHER PERFECT PICK";
    return { type: "pick_correct_milestone", message: `${label} — ${remaining} TO GO` };
  }
  return null;
}

/**
 * A moment type that, once recorded for a user's shared selection set in one competition,
 * must never be followed by any further SELECTION-PROGRESS moment for that same (user,
 * competition) — the entry's PERFECT run has definitively ended one way or the other.
 * Accepts `string` (not just this module's own MomentType) because the caller
 * (src/lib/data/moments.ts) reads this back off the database, whose stored type is the
 * wider schema MomentType (Feature 3 added round-lifecycle/settlement event types to that
 * same column) — this check only ever needs to compare against these two literal values.
 */
export function isTerminalMomentType(type: string): boolean {
  return type === "perfect" || type === "perfect_ended";
}

/**
 * Deterministic dedupe key for one moment — the same underlying event (replayed settlement,
 * a retried webhook, two concurrent settle calls) must always resolve to the exact same
 * key, so persisting it is a safe no-op on a retry rather than a duplicate notification.
 * Milestones include their own correct-count (3 and 5 are genuinely different events);
 * every other type is a one-time-ever terminal/near-terminal beat for this (user,
 * competition), so the type alone is enough.
 */
export function momentDedupeKey(userId: number, competitionId: number, candidate: MomentCandidate): string {
  const suffix = candidate.type === "pick_correct_milestone" ? String(candidate.message) : candidate.type;
  return `${userId}:${competitionId}:${candidate.type}:${suffix}`;
}
