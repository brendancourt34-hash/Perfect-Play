/**
 * Quick smoke test for the Phase 23 withdrawal lifecycle against the real running
 * backend. Creates one throwaway user (deposits funds via the wallet) and one throwaway
 * admin, exercises request -> reject and request -> complete, then deletes everything.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

const API_URL = "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
let passed = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`PASS: ${msg}`);
  passed++;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json();
  return { status: res.status, body };
}

async function registerUser(email: string) {
  const res = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password: "qa-test-password-123", name: "QA Withdrawals" }) });
  if (!res.body.ok) throw new Error(`register failed for ${email}: ${JSON.stringify(res.body)}`);
  return res.body.data.token as string;
}

async function main() {
  console.log("=== WITHDRAWALS SMOKE ===");
  const userEmail = `qa-withdraw-user-${Date.now()}@example.com`;
  const adminEmail = `qa-withdraw-admin-${Date.now()}@example.com`;
  const userToken = await registerUser(userEmail);
  const adminToken = await registerUser(adminEmail);
  const userAuth = { Authorization: `Bearer ${userToken}` };
  const adminAuth = { Authorization: `Bearer ${adminToken}` };

  const userRows = await db.select().from(schema.users).where(eq(schema.users.email, userEmail)).limit(1);
  const adminRows = await db.select().from(schema.users).where(eq(schema.users.email, adminEmail)).limit(1);
  const userId = userRows[0].id;
  const adminId = adminRows[0].id;
  await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, adminId));

  try {
    const insufficientRes = await api("/api/me/withdrawals", { method: "POST", headers: userAuth, body: JSON.stringify({ amountCents: 1000 }) });
    assert(insufficientRes.status === 422, "requesting a withdrawal with zero balance is rejected");

    // A deposit only ever confirms via a real payment-provider webhook — the dev provider
    // always reports "pending", so it correctly never credits real spendable balance (see
    // the wallet-crediting fix). This test is about withdrawal processing, not deposit
    // confirmation, so fund the wallet directly the same way every other QA fixture does.
    const depositRes = await api("/api/me/wallet/deposit", { method: "POST", headers: userAuth, body: JSON.stringify({ amountCents: 5000 }) });
    assert(depositRes.status === 200 && depositRes.body.data.confirmed === false, "a deposit attempt is honestly reported as unconfirmed — no real payment provider is connected");
    await db.insert(schema.wallets).values({ userId, balanceCents: 5000 }).onConflictDoUpdate({ target: schema.wallets.userId, set: { balanceCents: 5000 } });

    const requestRes = await api("/api/me/withdrawals", { method: "POST", headers: userAuth, body: JSON.stringify({ amountCents: 2000 }) });
    assert(requestRes.status === 201 && requestRes.body.data.withdrawal.status === "requested", "requesting a $20 withdrawal succeeds with status 'requested'");
    const withdrawalId = requestRes.body.data.withdrawal.id;

    const balanceAfterRequestRes = await api("/api/me/wallet", { headers: userAuth });
    assert(balanceAfterRequestRes.body.data.balanceCents === 5000, "requesting a withdrawal does NOT touch the balance yet");

    const nonAdminStatusRes = await api(`/api/admin/withdrawals/${withdrawalId}/status`, { method: "POST", headers: userAuth, body: JSON.stringify({ status: "completed" }) });
    assert(nonAdminStatusRes.status === 403, "a non-admin cannot process a withdrawal");

    const adminListRes = await api("/api/admin/withdrawals", { headers: adminAuth });
    assert(adminListRes.status === 200 && adminListRes.body.data.withdrawals.some((w: { id: number }) => w.id === withdrawalId), "the admin queue lists the pending withdrawal");

    const completeRes = await api(`/api/admin/withdrawals/${withdrawalId}/status`, { method: "POST", headers: adminAuth, body: JSON.stringify({ status: "completed" }) });
    assert(completeRes.status === 200 && completeRes.body.data.withdrawal.status === "completed", "admin marks the withdrawal completed");

    const balanceAfterCompleteRes = await api("/api/me/wallet", { headers: userAuth });
    assert(balanceAfterCompleteRes.body.data.balanceCents === 3000, "completing the withdrawal debits exactly $20 from the balance ($50 - $20 = $30)");

    const ledgerRows = await db.select().from(schema.walletTransactions).where(eq(schema.walletTransactions.userId, userId));
    const withdrawalTx = ledgerRows.find((t) => t.type === "withdrawal");
    assert(!!withdrawalTx && withdrawalTx.amountCents === -2000, "a withdrawal-type ledger row of -$20 was written");
    assert(withdrawalTx!.relatedWithdrawalId === withdrawalId, "the ledger row is linked back to the withdrawal it paid out");

    const doubleCompleteRes = await api(`/api/admin/withdrawals/${withdrawalId}/status`, { method: "POST", headers: adminAuth, body: JSON.stringify({ status: "rejected" }) });
    assert(doubleCompleteRes.status === 422, "a completed (terminal) withdrawal can never be transitioned again");

    const balanceAfterDoubleAttemptRes = await api("/api/me/wallet", { headers: userAuth });
    assert(balanceAfterDoubleAttemptRes.body.data.balanceCents === 3000, "the rejected re-transition attempt did not touch the balance a second time");

    // Second withdrawal: request then reject — balance should be untouched by rejection.
    const secondRequestRes = await api("/api/me/withdrawals", { method: "POST", headers: userAuth, body: JSON.stringify({ amountCents: 1000 }) });
    const secondWithdrawalId = secondRequestRes.body.data.withdrawal.id;
    const rejectRes = await api(`/api/admin/withdrawals/${secondWithdrawalId}/status`, { method: "POST", headers: adminAuth, body: JSON.stringify({ status: "rejected" }) });
    assert(rejectRes.status === 200 && rejectRes.body.data.withdrawal.status === "rejected", "a second withdrawal can be rejected");

    const balanceAfterRejectRes = await api("/api/me/wallet", { headers: userAuth });
    assert(balanceAfterRejectRes.body.data.balanceCents === 3000, "rejecting a withdrawal never debits the balance");

    const myWithdrawalsRes = await api("/api/me/withdrawals", { headers: userAuth });
    assert(myWithdrawalsRes.body.data.withdrawals.length === 2, "the user's own withdrawal history lists both requests");

    console.log(`\n=== WITHDRAWALS SMOKE: ${passed} checks passed ===`);
  } finally {
    console.log("Cleaning up QA data...");
    await db.delete(schema.withdrawals).where(eq(schema.withdrawals.userId, userId));
    await db.delete(schema.walletTransactions).where(eq(schema.walletTransactions.userId, userId));
    await db.delete(schema.wallets).where(eq(schema.wallets.userId, userId));
    await db.delete(schema.paymentTransactions).where(eq(schema.paymentTransactions.userId, userId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, adminId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.delete(schema.users).where(eq(schema.users.id, adminId));

    const leftoverUsers = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    assert(leftoverUsers.length === 0, "cleanup verified: zero rows remain for the QA users");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
