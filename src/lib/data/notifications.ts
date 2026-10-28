import { eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getRoundReadiness } from "@/lib/sports-data/readiness";
import { canAcceptEntries, getEffectiveCompetitionState } from "@/lib/competitions/lifecycle";
import {
  determineClosingReminderBuckets,
  entryClosingReminderEvent,
  entryMarketOpenEvent,
  prizeWonEvent,
  rolloverEvent,
  teamListsAvailableEvent,
  type CustomerEventCandidate,
} from "@/lib/perfect2/customer-events";
import { logEvent } from "@/lib/monitoring/log";
import { deliverPushForMoments } from "@/lib/push/delivery";
import { safeQuery, type DataResult } from "./result";

/**
 * Round-lifecycle and settlement-beyond-progress customer events (Feature 3) — built on
 * the SAME perfect_play_moments table/idempotency model as the selection-progress Perfect
 * Play Moments (src/lib/data/moments.ts), never a second notification architecture.
 *
 * Broadcast events (entry market open / team lists available / entry closing reminders)
 * have no subscription/topic model to target — this codebase has none — so "eligible
 * customers" is deliberately simplified to "every non-admin registered user," gated
 * strictly on the real, live competition/readiness state at the moment of the check
 * (never on a timer alone, never faked). Idempotency is enforced per (user, competition,
 * event) via perfect_play_moments.dedupeKey's UNIQUE constraint — re-running a check for
 * the same event is always a safe no-op for every user who already has a row, and simply
 * fills in any user who doesn't yet (e.g. registered since the last check).
 */

async function allNonAdminUserIds(): Promise<number[]> {
  const rows = await getDb().select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.isAdmin, false));
  return rows.map((r) => r.id);
}

/** Inserts one moment/event row per user, skipping (via the dedupeKey UNIQUE constraint) anyone who already has one for this exact event. Returns how many NEW rows were actually created. */
async function fanOutToUsers(userIds: readonly number[], competitionId: number, sportId: number, candidate: CustomerEventCandidate): Promise<number> {
  if (userIds.length === 0) return 0;
  const db = getDb();
  const values = userIds.map((userId) => ({
    userId,
    competitionId,
    sportId,
    type: candidate.type,
    message: candidate.message,
    // These three columns describe SELECTION progress — meaningless for a round-lifecycle
    // or settlement-level broadcast event, so they're 0 here, never a real progress state.
    correctSelections: 0,
    incorrectSelections: 0,
    totalSelections: 0,
    dedupeKey: `${userId}:${competitionId}:${candidate.dedupeSuffix}`,
  }));
  const inserted = await db
    .insert(schema.perfectPlayMoments)
    .values(values)
    .onConflictDoNothing({ target: schema.perfectPlayMoments.dedupeKey })
    .returning();
  // Push delivery happens after the insert is durably committed — see
  // src/lib/push/delivery.ts's doc comment: a push failure never affects the event rows
  // already created above, and delivery itself never throws back into this function.
  await deliverPushForMoments(inserted);
  return inserted.length;
}

/**
 * "ENTRIES ARE OPEN" — fires only once the competition's entry market is genuinely open
 * AND real team-list data is confirmed (getRoundReadiness.teamListsReady) — never on a
 * timer, never faked for a sport whose data provider doesn't yet support team lists (that
 * sport's readiness simply never becomes true, so this never fires for it).
 */
export async function checkAndFireEntryMarketOpen(competitionId: number): Promise<DataResult<number>> {
  return safeQuery(async () => {
    const db = getDb();
    const rows = await db.select().from(schema.competitions).where(eq(schema.competitions.id, competitionId)).limit(1);
    const competition = rows[0];
    if (!competition) return 0;
    if (getEffectiveCompetitionState(competition) !== "open") return 0;

    const readinessResult = await getRoundReadiness(competition.roundId);
    if (readinessResult.status === "unavailable") throw new Error(readinessResult.message);
    if (!readinessResult.data.teamListsReady) return 0;

    const userIds = await allNonAdminUserIds();
    const candidate = entryMarketOpenEvent();
    const created = await fanOutToUsers(userIds, competitionId, competition.sportId, candidate);
    if (created > 0) logEvent("customer_event_broadcast", { competitionId, type: candidate.type, recipients: created });
    return created;
  });
}

/** "TEAM LISTS ARE IN" — independent of whether the competition itself has opened yet (team lists can be confirmed before entries open); still only ever real data, never faked. */
export async function checkAndFireTeamListsAvailable(competitionId: number): Promise<DataResult<number>> {
  return safeQuery(async () => {
    const db = getDb();
    const rows = await db.select().from(schema.competitions).where(eq(schema.competitions.id, competitionId)).limit(1);
    const competition = rows[0];
    if (!competition) return 0;

    const [readinessResult, sportRows, roundRows] = await Promise.all([
      getRoundReadiness(competition.roundId),
      db.select().from(schema.sports).where(eq(schema.sports.id, competition.sportId)).limit(1),
      db.select().from(schema.rounds).where(eq(schema.rounds.id, competition.roundId)).limit(1),
    ]);
    if (readinessResult.status === "unavailable") throw new Error(readinessResult.message);
    if (!readinessResult.data.teamListsReady) return 0;

    const sportName = sportRows[0]?.name ?? "Perfect Play";
    const round = roundRows[0];
    const roundLabel = round?.name ?? (round ? `Round ${round.roundNumber}` : "round");

    const userIds = await allNonAdminUserIds();
    const candidate = teamListsAvailableEvent(sportName, roundLabel);
    const created = await fanOutToUsers(userIds, competitionId, competition.sportId, candidate);
    if (created > 0) logEvent("customer_event_broadcast", { competitionId, type: candidate.type, recipients: created });
    return created;
  });
}

/**
 * "10/5/1 MINUTES TO GO" — driven entirely by the round's real, authoritative
 * buyInCutoffAt (the first game's kickoff). Never fires once the competition can no
 * longer accept entries (closed/settled), which is exactly "don't notify users who are
 * already excluded/blocked from entering."
 */
export async function checkAndFireEntryClosingReminders(competitionId: number): Promise<DataResult<number>> {
  return safeQuery(async () => {
    const db = getDb();
    const rows = await db.select().from(schema.competitions).where(eq(schema.competitions.id, competitionId)).limit(1);
    const competition = rows[0];
    if (!competition) return 0;
    if (!canAcceptEntries(competition)) return 0;

    const readinessResult = await getRoundReadiness(competition.roundId);
    if (readinessResult.status === "unavailable") throw new Error(readinessResult.message);
    const cutoff = readinessResult.data.firstGameKickoffAt;
    if (!cutoff) return 0;

    const minutesRemaining = (cutoff.getTime() - Date.now()) / 60_000;
    const buckets = determineClosingReminderBuckets(minutesRemaining);
    if (buckets.length === 0) return 0;

    const userIds = await allNonAdminUserIds();
    let totalCreated = 0;
    for (const bucket of buckets) {
      const candidate = entryClosingReminderEvent(bucket);
      const created = await fanOutToUsers(userIds, competitionId, competition.sportId, candidate);
      totalCreated += created;
      if (created > 0) logEvent("customer_event_broadcast", { competitionId, type: candidate.type, bucket, recipients: created });
    }
    return totalCreated;
  });
}

/** Called from settlement.ts once a competition settles with zero PERFECT entries — the "almost won" audience is every entrant of THIS competition, never a broader broadcast. */
export async function fireRolloverNotifications(competitionId: number, sportId: number, entrantUserIds: readonly number[], isJackpot: boolean): Promise<DataResult<number>> {
  return safeQuery(async () => {
    const distinctUserIds = Array.from(new Set(entrantUserIds));
    const candidate = rolloverEvent(isJackpot);
    const created = await fanOutToUsers(distinctUserIds, competitionId, sportId, candidate);
    if (created > 0) logEvent("customer_event_broadcast", { competitionId, type: candidate.type, recipients: created });
    return created;
  });
}

export interface PrizeWonShare {
  userId: number;
  /** How many of THIS customer's own entries went PERFECT — entries determine shares, never unique-customer counts. */
  shareCount: number;
  /** This customer's total payout across all of their PERFECT entries. */
  amountCents: number;
}

/** Called from settlement.ts once prize credits are computed — one notification per WINNING CUSTOMER (not per entry), carrying their real share count and real payout. */
export async function firePrizeWonNotifications(competitionId: number, sportId: number, shares: readonly PrizeWonShare[]): Promise<DataResult<number>> {
  return safeQuery(async () => {
    const db = getDb();
    let created = 0;
    const newlyCreated: (typeof schema.perfectPlayMoments.$inferSelect)[] = [];
    for (const share of shares) {
      if (share.amountCents <= 0 || share.shareCount <= 0) continue;
      const candidate = prizeWonEvent(share.shareCount, share.amountCents);
      const inserted = await db
        .insert(schema.perfectPlayMoments)
        .values({
          userId: share.userId,
          competitionId,
          sportId,
          type: candidate.type,
          message: candidate.message,
          correctSelections: 0,
          incorrectSelections: 0,
          totalSelections: 0,
          dedupeKey: `${share.userId}:${competitionId}:${candidate.dedupeSuffix}`,
        })
        .onConflictDoNothing({ target: schema.perfectPlayMoments.dedupeKey })
        .returning();
      if (inserted[0]) {
        created++;
        newlyCreated.push(inserted[0]);
      }
    }
    if (created > 0) logEvent("customer_event_broadcast", { competitionId, type: "prize_won", recipients: created });
    await deliverPushForMoments(newlyCreated);
    return created;
  });
}

export interface RoundLifecycleCheckResult {
  competitionId: number;
  entryMarketOpen: number;
  teamListsAvailable: number;
  closingReminders: number;
}

/**
 * The scheduled-job boundary: runs every round-lifecycle check (entry market open, team
 * lists available, closing reminders) once across every not-yet-settled competition.
 * Deliberately NOT self-scheduling — this must only ever be invoked by an external
 * scheduler or an explicit admin action (see POST /api/admin/notifications/tick), never on
 * every app open and never by a busy-loop inside this codebase. A production deployment
 * would point a scheduler (e.g. Vercel Cron, on a 1-2 minute interval) at that route.
 */
export async function runRoundLifecycleNotificationChecks(): Promise<DataResult<RoundLifecycleCheckResult[]>> {
  return safeQuery(async () => {
    const db = getDb();
    const competitions = await db.select().from(schema.competitions).where(ne(schema.competitions.status, "settled"));

    const results: RoundLifecycleCheckResult[] = [];
    for (const c of competitions) {
      const [marketOpen, teamLists, closing] = await Promise.all([
        checkAndFireEntryMarketOpen(c.id),
        checkAndFireTeamListsAvailable(c.id),
        checkAndFireEntryClosingReminders(c.id),
      ]);
      results.push({
        competitionId: c.id,
        entryMarketOpen: marketOpen.status === "ok" ? marketOpen.data : 0,
        teamListsAvailable: teamLists.status === "ok" ? teamLists.data : 0,
        closingReminders: closing.status === "ok" ? closing.data : 0,
      });
    }
    return results;
  });
}
