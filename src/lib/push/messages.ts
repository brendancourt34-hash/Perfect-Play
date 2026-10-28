import type { MomentType } from "@/db/schema";

/**
 * Builds the push notification title/body/deep-link for one Perfect Play Moment/customer
 * event — kept entirely separate from the in-app `message` string (which combines both
 * into one line, e.g. "PERFECT ENDS HERE — 3/8") because a push notification needs a
 * proper title/body split, and because the wording conventions differ slightly (the
 * product's push-copy examples use full sentences in the body; the in-app moment feed
 * uses the terser combined line). Never invents a number — every dynamic value here comes
 * straight off the already-persisted moment row (correctSelections/incorrectSelections/
 * totalSelections) or is parsed out of that SAME row's own message field for the two
 * fields that don't have a dedicated column (the entry-closing bucket, the prize
 * share count/amount) — never a second, independently-computed source of truth.
 */
export interface PushMomentInput {
  type: MomentType;
  message: string;
  correctSelections: number;
  incorrectSelections: number;
  totalSelections: number;
  competitionId: number;
}

/** Which mobile screen a tapped push should open — resolved once per moment type, never guessed client-side. "round-entry"/"results" need sportCode+roundId (added by the delivery service, which has DB access — see src/lib/push/delivery.ts); "my-entries" needs nothing further. */
export type PushDeepLinkScreen = "round-entry" | "my-entries" | "results";

export interface PushContent {
  title: string;
  body: string;
  /** Carried as the Expo push message's `data` payload — read by the mobile app's notification-response handler to route to the right screen (see mobile/lib/push-notifications.ts). sportCode/roundId are filled in by the delivery service for screens that need them. */
  data: { type: MomentType; competitionId: number; screen: PushDeepLinkScreen; sportCode?: string; roundId?: number };
}

export function buildPushContent(moment: PushMomentInput): PushContent {
  const data = { type: moment.type, competitionId: moment.competitionId, screen: pushDeepLinkScreen(moment.type) };
  const remaining = moment.totalSelections - moment.correctSelections - moment.incorrectSelections;

  switch (moment.type) {
    case "entry_market_open":
      return { title: "ENTRIES ARE OPEN", body: "Team lists are confirmed. Pick your players and go PERFECT.", data };

    case "team_lists_available": {
      // Message format: "TEAM LISTS ARE IN — {sport} {round} lineups are confirmed. Get ready to pick."
      const body = moment.message.split(" — ")[1] ?? "Lineups are confirmed. Get ready to pick.";
      return { title: "TEAM LISTS ARE IN", body, data };
    }

    case "entry_closing_soon":
      return moment.message.includes("10 MINUTES")
        ? { title: "10 MINUTES TO GO", body: "Entries close soon. Lock in your picks.", data }
        : { title: "5 MINUTES TO GO", body: "5 minutes left to go PERFECT.", data };

    case "entry_closing_now":
      return { title: "1 MINUTE TO GO", body: "Entries close in 1 minute. Finalise your picks now.", data };

    case "pick_correct_milestone": {
      const title = moment.correctSelections >= 5 ? "STILL PERFECT" : "ANOTHER PERFECT PICK";
      return { title, body: `${remaining} to go.`, data };
    }

    case "one_left": {
      // Message format: "{correct}/{total} PERFECT — ONE PICK LEFT" or "... ONE GAME LEFT" — the
      // unit word is reliably recoverable from the message this row already stored (see
      // src/lib/perfect2/moments.ts's computeMoment), never re-derived from a second lookup.
      const unitMatch = moment.message.match(/ONE (PICK|GAME) LEFT/);
      const unit = unitMatch ? unitMatch[1] : "PICK";
      return {
        title: `ONE ${unit} LEFT`,
        body: `${moment.correctSelections}/${moment.totalSelections} PERFECT. One selection stands between you and PERFECT.`,
        data,
      };
    }

    case "perfect":
      return { title: "YOU WENT PERFECT", body: "All your selections are correct.", data };

    case "perfect_ended":
      return { title: "PERFECT ENDS HERE", body: `${moment.correctSelections}/${moment.totalSelections} selections correct.`, data };

    case "prize_won": {
      // Message format: "YOU WON — {N} SHARE(S) OF THE PRIZE POOL — {$amount}"
      const parts = moment.message.split(" — ");
      const shareCount = parts[1]?.match(/\d+/)?.[0] ?? "";
      const amount = parts[2] ?? "";
      return { title: "YOU WON", body: `${shareCount} PERFECT shares. ${amount} won.`, data };
    }

    case "rollover":
      return { title: "ROLLOVER", body: "No entries went PERFECT. The Prize Pool rolls over.", data };

    case "rollover_jackpot":
      return { title: "ROLLOVER JACKPOT", body: "No entries went PERFECT. The Prize Pool rolls over.", data };

    default:
      return { title: "PERFECT PLAY", body: moment.message, data };
  }
}

/**
 * Which mobile screen a tapped push should open — kept alongside the message builder
 * since the routing decision is intrinsic to the event type, same as the copy is. Mirrors
 * mobile/lib/push-notifications.ts's actual router calls; changing one without the other
 * is a bug. Perfect Play Moments (progression/terminal events) route to "my-entries"
 * (product spec: "My Entry / entry detail") rather than one specific entry ID — a
 * competition-scoped moment has no single canonical entry when a customer holds several
 * identical entries in it, and the My Entries screen's grouped view is exactly the "My
 * Entry" destination for that shared selection set.
 */
function pushDeepLinkScreen(type: MomentType): PushDeepLinkScreen {
  switch (type) {
    case "entry_market_open":
    case "team_lists_available":
    case "entry_closing_soon":
    case "entry_closing_now":
      return "round-entry";
    case "rollover":
    case "rollover_jackpot":
      return "results";
    case "pick_correct_milestone":
    case "one_left":
    case "perfect":
    case "perfect_ended":
    case "prize_won":
    default:
      return "my-entries";
  }
}
