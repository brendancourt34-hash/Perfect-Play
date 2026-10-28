import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { MomentType } from "@/db/schema";
import { computeMoment, isTerminalMomentType, momentDedupeKey, type SelectionProgress } from "@/lib/perfect2/moments";
import { getSelectionConfig } from "@/lib/perfect2/registry";
import { logEvent } from "@/lib/monitoring/log";
import { deliverPushForMoments, type DeliverableMoment } from "@/lib/push/delivery";
import { safeQuery, type DataResult } from "./result";

export type PerfectPlayMoment = typeof schema.perfectPlayMoments.$inferSelect;

export interface UserCompetitionProgress extends SelectionProgress {
  userId: number;
  competitionId: number;
  sportId: number;
  sportCode: string;
}

/**
 * Generates and idempotently persists Perfect Play Moments for a settlement pass.
 *
 * ONE call per settle pass, fed ONE progress row per (userId, competitionId) — never one
 * per individual competition_entries row. Every entry a customer holds in one competition
 * shares an identical canonical selection set (see entry-packages.ts), so a customer
 * holding 10 identical entries produces exactly one moment per progression beat here, not
 * ten duplicate notifications — settleCompetition (src/lib/data/settlement.ts) builds this
 * input by collapsing its per-entry loop onto userId before calling this.
 *
 * Idempotent two ways: (1) a user/competition that has already reached a terminal moment
 * (PERFECT or PERFECT_ENDED) is skipped entirely — the run is over, no further moments are
 * possible for it, regardless of what settlement recomputes later; (2) every insert is
 * guarded by dedupeKey's UNIQUE constraint (onConflictDoNothing), so even a fully
 * concurrent or retried settlement pass can never create a duplicate row for the same
 * underlying event.
 */
export async function generateMomentsForSettlement(progressRows: readonly UserCompetitionProgress[]): Promise<DataResult<number>> {
  return safeQuery(async () => {
    if (progressRows.length === 0) return 0;
    const db = getDb();

    const competitionIds = Array.from(new Set(progressRows.map((r) => r.competitionId)));
    // One query for every existing moment across every competition in this settle pass —
    // cheap relative to the per-entry settlement work already done by the caller, and lets
    // the terminal-state check below be a pure in-memory lookup rather than a query per user.
    const existing = competitionIds.length
      ? await db.select().from(schema.perfectPlayMoments).where(inArray(schema.perfectPlayMoments.competitionId, competitionIds))
      : [];
    const terminalUsers = new Set(
      existing.filter((m) => isTerminalMomentType(m.type)).map((m) => `${m.userId}:${m.competitionId}`),
    );

    let created = 0;
    const newlyCreated: DeliverableMoment[] = [];
    for (const row of progressRows) {
      const key = `${row.userId}:${row.competitionId}`;
      if (terminalUsers.has(key)) continue; // The run already ended (won or lost) — never a moment after that.

      const config = getSelectionConfig(row.sportCode);
      const candidate = computeMoment(row, config.oneRemainingLabel);
      if (!candidate) continue;

      const dedupeKey = momentDedupeKey(row.userId, row.competitionId, candidate);
      const inserted = await db
        .insert(schema.perfectPlayMoments)
        .values({
          userId: row.userId,
          competitionId: row.competitionId,
          sportId: row.sportId,
          type: candidate.type,
          message: candidate.message,
          correctSelections: row.correctSelections,
          incorrectSelections: row.incorrectSelections,
          totalSelections: row.totalSelections,
          dedupeKey,
        })
        .onConflictDoNothing({ target: schema.perfectPlayMoments.dedupeKey })
        .returning();
      if (inserted[0]) {
        created++;
        if (isTerminalMomentType(candidate.type)) terminalUsers.add(key); // Never fire twice within the same settle pass either.
        logEvent("perfect_play_moment_created", {
          userId: row.userId,
          competitionId: row.competitionId,
          sportId: row.sportId,
          type: candidate.type,
        });
        newlyCreated.push(inserted[0]);
      }
    }
    // Push delivery happens AFTER every row this pass created is durably committed — a
    // push failure (or Expo being unreachable) can never undo or fail this settlement
    // pass; the moments above are already real regardless of what happens next. The
    // in-app Moments feed (listMomentsForUser) is the source of truth independent of push.
    await deliverPushForMoments(newlyCreated);
    return created;
  });
}

/** The current user's own moments — newest first, optionally scoped to one competition (e.g. "this round's story so far" on an entry/results page). Never another user's. */
export async function listMomentsForUser(userId: number, competitionId?: number): Promise<DataResult<PerfectPlayMoment[]>> {
  return safeQuery(async () => {
    const db = getDb();
    const conditions = competitionId != null
      ? and(eq(schema.perfectPlayMoments.userId, userId), eq(schema.perfectPlayMoments.competitionId, competitionId))
      : eq(schema.perfectPlayMoments.userId, userId);
    return db.select().from(schema.perfectPlayMoments).where(conditions).orderBy(desc(schema.perfectPlayMoments.createdAt)).limit(100);
  });
}

/** Marks every currently-unread moment belonging to this user as read (in-app "seen" state only — never affects settlement/eligibility). Returns how many rows were updated. */
export async function markMomentsRead(userId: number): Promise<DataResult<number>> {
  return safeQuery(async () => {
    const rows = await getDb()
      .update(schema.perfectPlayMoments)
      .set({ readAt: new Date() })
      .where(and(eq(schema.perfectPlayMoments.userId, userId), isNull(schema.perfectPlayMoments.readAt)))
      .returning({ id: schema.perfectPlayMoments.id });
    return rows.length;
  });
}

export type { MomentType };
