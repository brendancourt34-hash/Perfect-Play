/**
 * Customer event message catalogue — the round-lifecycle and settlement-beyond-progress
 * half of the Perfect Play Moments system (see src/lib/perfect2/moments.ts for the
 * selection-progress half). Pure functions only (no I/O, no Date.now() for anything but
 * the caller-supplied minutesRemaining) — the actual persistence/fan-out/idempotency
 * lives in src/lib/data/notifications.ts, which is what's actually invoked from
 * settlement.ts and the admin-callable scheduled-job endpoint. Kept in the SAME
 * momentTypeValues/perfect_play_moments architecture as selection-progress moments
 * deliberately — this is one notification system, not two.
 */
import type { MomentType } from "@/db/schema";
import { formatAudCents } from "@/lib/utils/format";

export interface CustomerEventCandidate {
  type: MomentType;
  message: string;
  /** Combined with (userId, competitionId) by the data layer to form the final dedupeKey — see src/lib/data/notifications.ts. */
  dedupeSuffix: string;
}

/** "Entries are open" — only ever generated once real team-list data is confirmed (see src/lib/data/notifications.ts:checkAndFireEntryMarketOpen); never fabricated. */
export function entryMarketOpenEvent(): CustomerEventCandidate {
  return {
    type: "entry_market_open",
    message: "ENTRIES ARE OPEN — Team lists are confirmed. Pick your players and go PERFECT.",
    dedupeSuffix: "entry_market_open",
  };
}

export function teamListsAvailableEvent(sportName: string, roundLabel: string): CustomerEventCandidate {
  return {
    type: "team_lists_available",
    message: `TEAM LISTS ARE IN — ${sportName} ${roundLabel} lineups are confirmed. Get ready to pick.`,
    dedupeSuffix: "team_lists_available",
  };
}

export type ClosingReminderBucket = "10" | "5" | "1";

/** Which reminder bucket(s) are currently active for a given time-to-cutoff — a caller ticking irregularly may see more than one bucket active at once (e.g. the first tick after a long gap); each is idempotent on its own dedupe key regardless. Never active once the cutoff has passed (negative minutesRemaining). */
export function determineClosingReminderBuckets(minutesRemaining: number): ClosingReminderBucket[] {
  if (minutesRemaining < 0) return [];
  const buckets: ClosingReminderBucket[] = [];
  if (minutesRemaining <= 10) buckets.push("10");
  if (minutesRemaining <= 5) buckets.push("5");
  if (minutesRemaining <= 1) buckets.push("1");
  return buckets;
}

const CLOSING_REMINDER_EVENTS: Record<ClosingReminderBucket, CustomerEventCandidate> = {
  "10": { type: "entry_closing_soon", message: "10 MINUTES TO GO — Entries close soon. Lock in your picks.", dedupeSuffix: "entry_closing_soon:10" },
  "5": { type: "entry_closing_soon", message: "5 MINUTES TO GO — 5 minutes left to go PERFECT.", dedupeSuffix: "entry_closing_soon:5" },
  "1": { type: "entry_closing_now", message: "1 MINUTE TO GO — Entries close in 1 minute. Finalise your picks now.", dedupeSuffix: "entry_closing_now" },
};

export function entryClosingReminderEvent(bucket: ClosingReminderBucket): CustomerEventCandidate {
  return CLOSING_REMINDER_EVENTS[bucket];
}

/** isJackpot = true when the pool that just failed to find a winner already contained a prior rollover (i.e. this is now at least the second consecutive rollover, a growing jackpot) — see src/lib/data/settlement.ts's call site. */
export function rolloverEvent(isJackpot: boolean): CustomerEventCandidate {
  return isJackpot
    ? {
        type: "rollover_jackpot",
        message: "ROLLOVER JACKPOT — No PERFECT entries this round. The Prize Pool keeps growing into next round.",
        dedupeSuffix: "rollover_jackpot",
      }
    : {
        type: "rollover",
        message: "NO PERFECT ENTRIES. THE PRIZE POOL ROLLS OVER TO THE NEXT ROUND.",
        dedupeSuffix: "rollover",
      };
}

/** One customer's actual settled result — entries determine shares, never unique-customer counts (see settlement.ts's allocation math). shareCount is how many of THEIR OWN entries went PERFECT, amountCents is their total payout across all of them. */
export function prizeWonEvent(shareCount: number, amountCents: number): CustomerEventCandidate {
  const shareLabel = `${shareCount} ${shareCount === 1 ? "SHARE" : "SHARES"}`;
  return {
    type: "prize_won",
    message: `YOU WON — ${shareLabel} OF THE PRIZE POOL — ${formatAudCents(amountCents)}`,
    dedupeSuffix: "prize_won",
  };
}
