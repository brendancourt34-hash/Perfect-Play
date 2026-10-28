import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { MomentType } from "@/db/schema";
import { buildPushContent } from "./messages";
import { sendExpoPushNotifications, type ExpoPushMessage } from "./expo-client";
import { listActiveTokensForUsers, removePushToken } from "@/lib/data/push-tokens";
import { logEvent } from "@/lib/monitoring/log";

/**
 * The delivery boundary between "a customer event/moment was just persisted" and "Expo
 * push API." This is the ONLY place those two things connect — moment/event generation
 * (src/lib/data/moments.ts, src/lib/data/notifications.ts) always persists first, then
 * calls this, and this function is built to NEVER throw back into that caller: a push
 * failure must never undo or fail the already-committed database write. In-app visibility
 * (the Moments feed, read from the same table) is completely independent of whether this
 * succeeds, fails, or nobody has push registered at all.
 *
 * No queue infrastructure exists in this codebase yet, so this runs inline (awaited) —
 * the module boundary here is exactly what a future queue-based worker would call instead
 * of running inline, so moving to one later is an infrastructure change, not a rewrite.
 */
export interface DeliverableMoment {
  userId: number;
  competitionId: number;
  sportId: number;
  type: MomentType;
  message: string;
  correctSelections: number;
  incorrectSelections: number;
  totalSelections: number;
}

export async function deliverPushForMoments(moments: readonly DeliverableMoment[]): Promise<void> {
  if (moments.length === 0) return;

  try {
    const userIds = Array.from(new Set(moments.map((m) => m.userId)));
    const tokensResult = await listActiveTokensForUsers(userIds);
    if (tokensResult.status === "unavailable") {
      logEvent("push_send_failed", { stage: "token_lookup", message: tokensResult.message }, "error");
      return;
    }
    if (tokensResult.data.length === 0) return; // Nobody here has push registered — the moment is already visible in-app regardless.

    const tokensByUser = new Map<number, string[]>();
    for (const t of tokensResult.data) {
      if (!tokensByUser.has(t.userId)) tokensByUser.set(t.userId, []);
      tokensByUser.get(t.userId)!.push(t.token);
    }

    // Resolve sportCode/roundId for the deep-link payload — only competitions that
    // actually appear in this batch, one small batched query each, never N+1.
    const competitionIds = Array.from(new Set(moments.map((m) => m.competitionId)));
    const db = getDb();
    const competitions = competitionIds.length ? await db.select().from(schema.competitions).where(inArray(schema.competitions.id, competitionIds)) : [];
    const sportIds = Array.from(new Set(competitions.map((c) => c.sportId)));
    const sports = sportIds.length ? await db.select().from(schema.sports).where(inArray(schema.sports.id, sportIds)) : [];
    const sportCodeBySportId = new Map(sports.map((s) => [s.id, s.code]));
    const competitionById = new Map(competitions.map((c) => [c.id, c]));

    const messages: ExpoPushMessage[] = [];
    for (const moment of moments) {
      const userTokens = tokensByUser.get(moment.userId);
      if (!userTokens || userTokens.length === 0) continue;

      const content = buildPushContent(moment);
      if (content.data.screen === "round-entry" || content.data.screen === "results") {
        const competition = competitionById.get(moment.competitionId);
        content.data.roundId = competition?.roundId;
        content.data.sportCode = competition ? sportCodeBySportId.get(competition.sportId) : undefined;
      }

      for (const token of userTokens) {
        messages.push({ to: token, title: content.title, body: content.body, data: content.data, sound: "default" });
      }
    }
    if (messages.length === 0) return;

    const result = await sendExpoPushNotifications(messages);
    for (const invalidToken of result.invalidTokens) {
      const removed = await removePushToken(invalidToken);
      if (removed.status === "ok") logEvent("push_token_removed", { reason: "device_not_registered" });
    }
  } catch (error) {
    // Absolute last-resort guard — every awaited call above already catches its own
    // errors, but this function must categorically never throw into settlement.ts /
    // notifications.ts, whatever happens.
    logEvent("push_send_failed", { stage: "delivery", message: error instanceof Error ? error.message : String(error) }, "error");
  }
}
