import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { PushTokenPlatform } from "@/db/schema";
import { safeQuery, type DataResult } from "./result";

export type PushToken = typeof schema.pushTokens.$inferSelect;

/**
 * Registers (or refreshes) a device push token for a user — architecture boundary only,
 * ready for Expo push to be wired up later (see src/db/schema.ts's pushTokens doc
 * comment). Nothing reads this table to actually send a push today. Idempotent: the same
 * token registering again just bumps lastSeenAt and (if it changed) which user owns it —
 * a device can be re-registered under a different account (e.g. after logout/login)
 * without leaving stale rows behind.
 */
export async function registerPushToken(userId: number, token: string, platform: PushTokenPlatform): Promise<DataResult<void>> {
  return safeQuery(async () => {
    const db = getDb();
    await db
      .insert(schema.pushTokens)
      .values({ userId, token, platform })
      .onConflictDoUpdate({ target: schema.pushTokens.token, set: { userId, platform, lastSeenAt: new Date() } });
  });
}

/** Removes a device's push token — called by the delivery service once Expo reports a token as permanently invalid (DeviceNotRegistered). System-initiated only: the token value comes from Expo's own API response, never from a customer-facing request, so no caller identity to scope against. Customer-facing removal (logout/opt-out) must go through removePushTokenForUser instead. */
export async function removePushToken(token: string): Promise<DataResult<void>> {
  return safeQuery(async () => {
    await getDb().delete(schema.pushTokens).where(eq(schema.pushTokens.token, token));
  });
}

/** Customer-facing token removal (logout/opt-out) — scoped to the CALLING user's own token so one authenticated customer can never remove another customer's device token by guessing/obtaining its value. A token that doesn't belong to this user (or doesn't exist) is a safe no-op, never an error — same idempotent-delete convention as removePushToken. */
export async function removePushTokenForUser(userId: number, token: string): Promise<DataResult<void>> {
  return safeQuery(async () => {
    await getDb().delete(schema.pushTokens).where(and(eq(schema.pushTokens.token, token), eq(schema.pushTokens.userId, userId)));
  });
}

/**
 * Every registered device token for a set of users — the delivery service's only read
 * path into this table. Never exposed directly to any customer-facing API response (see
 * the push-tokens route, which only ever returns `{registered: true}` / `{removed: true}`,
 * never token values) — this is a server-internal lookup only. A user with zero tokens
 * (push never set up, or explicitly removed) simply gets an empty array back — the caller
 * treats that as "in-app only," never an error.
 */
export async function listActiveTokensForUsers(userIds: readonly number[]): Promise<DataResult<PushToken[]>> {
  return safeQuery(async () => {
    if (userIds.length === 0) return [];
    return getDb().select().from(schema.pushTokens).where(inArray(schema.pushTokens.userId, userIds));
  });
}
