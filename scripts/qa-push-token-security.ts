/**
 * Regression test for the push-token ownership fix (audit finding, Feature 2 follow-up):
 * DELETE /api/me/push-tokens previously removed a push_tokens row by TOKEN VALUE ALONE,
 * with no check that the token belonged to the calling user — any authenticated customer
 * who obtained another customer's token value could silence that customer's push
 * notifications. Fixed via removePushTokenForUser (src/lib/data/push-tokens.ts), scoped to
 * (token, userId). This script proves the fix end-to-end against the real running backend.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

const API_URL = "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
const MARK = `qa-push-token-security-${Date.now()}`;
let passed = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`PASS: ${msg}`);
  passed++;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(path: string, token: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
  return { status: res.status, body: await res.json() };
}

async function registerUser(email: string): Promise<{ token: string; userId: number }> {
  const res = await fetch(`${API_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "qa-test-password-123", name: "QA Push Security" }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`register failed for ${email}: ${JSON.stringify(body)}`);
  return { token: body.data.token as string, userId: body.data.user.id as number };
}

async function main() {
  const userA = await registerUser(`${MARK}-a@example.com`);
  const userB = await registerUser(`${MARK}-b@example.com`);

  const tokenValue = `ExponentPushToken[${MARK}-device]`;
  const reg = await api("/api/me/push-tokens", userA.token, { method: "POST", body: JSON.stringify({ token: tokenValue, platform: "ios" }) });
  assert(reg.status === 200 && reg.body.ok, "user A registers their device token");

  const [rowAfterRegister] = await db.select().from(schema.pushTokens).where(eq(schema.pushTokens.token, tokenValue)).limit(1);
  assert(!!rowAfterRegister && rowAfterRegister.userId === userA.userId, "token row exists and is owned by user A");

  // The actual attack: user B (a normal, unprivileged, authenticated customer) attempts to
  // remove user A's token by guessing/supplying its value.
  const maliciousDelete = await api("/api/me/push-tokens", userB.token, { method: "DELETE", body: JSON.stringify({ token: tokenValue }) });
  assert(maliciousDelete.status === 200 && maliciousDelete.body.ok, "DELETE still returns a generic ok (never reveals whether the token belongs to someone else)");

  const [rowAfterAttack] = await db.select().from(schema.pushTokens).where(eq(schema.pushTokens.token, tokenValue)).limit(1);
  assert(!!rowAfterAttack, "user A's token row STILL EXISTS — user B's delete was a no-op, not a real removal");
  assert(rowAfterAttack.userId === userA.userId, "token ownership is unchanged after the attempted cross-user delete");

  // The legitimate path still works: user A can remove their own token.
  const legitimateDelete = await api("/api/me/push-tokens", userA.token, { method: "DELETE", body: JSON.stringify({ token: tokenValue }) });
  assert(legitimateDelete.status === 200 && legitimateDelete.body.ok, "user A removes their own token");
  const rowsAfterLegitimate = await db.select().from(schema.pushTokens).where(eq(schema.pushTokens.token, tokenValue));
  assert(rowsAfterLegitimate.length === 0, "token row is actually gone after the OWNING user removes it");

  // Cleanup.
  await db.delete(schema.pushTokens).where(and(eq(schema.pushTokens.token, tokenValue)));
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userA.userId));
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userB.userId));
  await db.delete(schema.users).where(eq(schema.users.id, userA.userId));
  await db.delete(schema.users).where(eq(schema.users.id, userB.userId));

  console.log(`\n${passed} assertions passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
