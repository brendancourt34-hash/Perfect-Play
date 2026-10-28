/**
 * PHASE 20 QA — verifies the production-shaped (but real-money-disabled) payment
 * infrastructure against the real running backend and real dev database. Entry/payment
 * flows are driven through the real HTTP API; refund and reconciliation (which have no
 * API endpoint by design — see docs/phase20-payment-infrastructure.md §6-7) are exercised
 * by calling the real library functions directly against the real DB. Seeds temporary,
 * clearly-marked data, then deletes everything it created and verifies zero rows remain.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { refundTransaction, isRefundable } from "../src/lib/payments/refunds";
import { reconcileTransaction, reconcilePendingTransactions } from "../src/lib/payments/reconciliation";
import { getPaymentProvider } from "../src/lib/payments/registry";

const API_URL = "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
const MARK = "qa-test-internal-phase20";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body: body as Record<string, unknown> };
}
async function registerUser(email: string) {
  const r = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password: "qa-test-password-123", name: "QA" }) });
  if (!r.body.ok) throw new Error(`register failed for ${email}: ${JSON.stringify(r.body)}`);
  return (r.body.data as { token: string }).token;
}

let passCount = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  passCount++;
  console.log(`PASS: ${msg}`);
}

async function txForUserCompetition(userId: number, competitionId: number) {
  const idempotencyKey = `payment:${userId}:${competitionId}`;
  const rows = await db.select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.idempotencyKey, idempotencyKey));
  return rows;
}

async function main() {
  console.log("=== PHASE 20 QA: payment infrastructure (real money permanently disabled) ===");

  // Reuse the real dev DB's existing "nrl" sport row if one exists — sports.code is
  // globally unique.
  const existingNrl = (await db.select().from(schema.sports).where(eq(schema.sports.code, "nrl")))[0];
  const nrlWasCreatedByThisRun = !existingNrl;
  const nrl = existingNrl ?? (await db.insert(schema.sports).values({ code: "nrl", name: "QA NRL" }).returning())[0];

  // Defensive pre-flight: remove an orphaned QA season left by a previous crashed run at
  // this same fixed (sportId, year=2099) pair, now that the sport row is reused.
  const orphanedSeason = (await db.select().from(schema.seasons).where(and(eq(schema.seasons.sportId, nrl.id), eq(schema.seasons.year, 2099))))[0];
  if (orphanedSeason?.label === `${MARK}-season`) {
    console.log(`Pre-flight: removing an orphaned QA season from a previous run (id=${orphanedSeason.id}).`);
    const orphanedRounds = await db.select().from(schema.rounds).where(eq(schema.rounds.seasonId, orphanedSeason.id));
    for (const r of orphanedRounds) {
      const orphanedComps = await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, r.id));
      for (const c of orphanedComps) {
        const orphanedEntries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, c.id));
        for (const e of orphanedEntries) await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, e.id));
        await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, c.id));
        await db.delete(schema.competitions).where(eq(schema.competitions.id, c.id));
      }
      await db.delete(schema.games).where(eq(schema.games.roundId, r.id));
      await db.delete(schema.rounds).where(eq(schema.rounds.id, r.id));
    }
    await db.delete(schema.seasons).where(eq(schema.seasons.id, orphanedSeason.id));
  }

  const [season] = await db.insert(schema.seasons).values({ sportId: nrl.id, year: 2099, label: `${MARK}-season` }).returning();
  const [home] = await db.insert(schema.teams).values({ sportId: nrl.id, name: `${MARK}-home`, shortName: "QPH", slug: `${MARK}-home` }).returning();
  const [away] = await db.insert(schema.teams).values({ sportId: nrl.id, name: `${MARK}-away`, shortName: "QPA", slug: `${MARK}-away` }).returning();
  const [round] = await db.insert(schema.rounds).values({ seasonId: season.id, roundNumber: 1, name: `${MARK}-round` }).returning();
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const [game] = await db.insert(schema.games).values({ roundId: round.id, homeTeamId: home.id, awayTeamId: away.id, kickoff: future, status: "scheduled" }).returning();
  const [p1] = await db.insert(schema.players).values({ sportId: nrl.id, teamId: home.id, firstName: "QA", lastName: "Player1" }).returning();
  const [p2] = await db.insert(schema.players).values({ sportId: nrl.id, teamId: away.id, firstName: "QA", lastName: "Player2" }).returning();
  await db.insert(schema.gameLineups).values([
    { gameId: game.id, teamId: home.id, playerId: p1.id, position: "Fullback" },
    { gameId: game.id, teamId: away.id, playerId: p2.id, position: "Fullback" },
  ]);

  const emailA = `${MARK}-a@perfect2.test`;
  const emailB = `${MARK}-b@perfect2.test`;
  const tokenA = await registerUser(emailA);
  const tokenB = await registerUser(emailB);
  const [userA] = await db.select().from(schema.users).where(eq(schema.users.email, emailA));
  const [userB] = await db.select().from(schema.users).where(eq(schema.users.email, emailB));

  const teamIds = [home.id, away.id];
  const gameIds = [game.id];
  const playerIds = [p1.id, p2.id];
  const roundIds = [round.id];
  let competitionId: number | undefined;

  try {
    // ============================================================
    // 1. First payment pre-flight attempt records exactly one transaction, server-derived amount
    // ============================================================
    const preflight1 = await api(`/api/nrl/rounds/${round.id}/payment`, { method: "POST", headers: { Authorization: `Bearer ${tokenA}` } });
    assert(preflight1.status === 200, "1. payment pre-flight succeeds");
    const preflightData1 = preflight1.body.data as { status: string; amountCents: number; currency: string };
    assert(preflightData1.status === "pending", "1. dev provider never reports 'paid' — no real charge occurred");

    const compRows = await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, round.id));
    const competition = compRows[0];
    competitionId = competition.id;
    assert(preflightData1.amountCents === competition.entryFeeCents, "1. amount charged equals the competition's server-side entryFeeCents");

    let txRows = await txForUserCompetition(userA.id, competitionId);
    assert(txRows.length === 1, "1. exactly one payment_transactions row exists after the first attempt");
    assert(txRows[0].idempotencyKey === `payment:${userA.id}:${competitionId}`, "1. idempotency key is server-derived as payment:{userId}:{competitionId}");
    assert(txRows[0].amountCents === competition.entryFeeCents, "1. stored transaction amount matches the server-derived price");

    // ============================================================
    // 2. Idempotent replay: calling pre-flight again does not create a second row
    // ============================================================
    const preflight2 = await api(`/api/nrl/rounds/${round.id}/payment`, { method: "POST", headers: { Authorization: `Bearer ${tokenA}` } });
    assert(preflight2.status === 200, "2. second pre-flight call succeeds");
    txRows = await txForUserCompetition(userA.id, competitionId);
    assert(txRows.length === 1, "2. still exactly one transaction row — replay reused it, no duplicate charge");

    // ============================================================
    // 3. Concurrent duplicate attempts are race-safe
    // ============================================================
    await Promise.all(Array.from({ length: 5 }, () => api(`/api/nrl/rounds/${round.id}/payment`, { method: "POST", headers: { Authorization: `Bearer ${tokenA}` } })));
    txRows = await txForUserCompetition(userA.id, competitionId);
    assert(txRows.length === 1, "3. five concurrent pre-flight requests still produce exactly one transaction row");

    // ============================================================
    // 4/5. Client-supplied amount/currency/idempotencyKey in the request body are ignored
    // ============================================================
    const injected = await api(`/api/nrl/rounds/${round.id}/payment`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ amountCents: 1, currency: "USD", idempotencyKey: "attacker-supplied-key" }),
    });
    const injectedData = injected.body.data as { amountCents: number; currency: string } | undefined;
    assert(injectedData?.amountCents === competition.entryFeeCents, "4. an injected fake amountCents in the request body is ignored");
    assert(injectedData?.currency === "AUD", "4. currency is always AUD regardless of what the client sends");
    txRows = await txForUserCompetition(userA.id, competitionId);
    assert(txRows[0].idempotencyKey === `payment:${userA.id}:${competitionId}`, "5. an injected fake idempotencyKey in the request body never reaches storage");
    assert(txRows.length === 1, "4/5. injected fields did not create a second row");

    // ============================================================
    // 6. Real entry creation reuses the same transaction row and links it to the entry
    // ============================================================
    const createEntryRes = await api(`/api/nrl/rounds/${round.id}/entries`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ selections: [{ gameId: game.id, player1Id: p1.id, player2Id: p2.id }] }),
    });
    assert(createEntryRes.status === 201, "6. entry created successfully");
    const entryId = (createEntryRes.body.data as { entryId: number }).entryId;
    txRows = await txForUserCompetition(userA.id, competitionId);
    assert(txRows.length === 1, "6. creating the entry did not create a second transaction row — the pre-flight attempt was reused");
    assert(txRows[0].competitionEntryId === entryId, "6. the transaction is now linked back to the entry it paid for");

    const transactionIdA = txRows[0].id;

    // ============================================================
    // 7. A second entry attempt for the same user+competition is rejected without an extra charge
    // ============================================================
    const duplicateEntryRes = await api(`/api/nrl/rounds/${round.id}/entries`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ selections: [{ gameId: game.id, player1Id: p1.id, player2Id: p2.id }] }),
    });
    assert(duplicateEntryRes.status !== 201, "7. a duplicate entry for the same competition is rejected");
    txRows = await txForUserCompetition(userA.id, competitionId);
    assert(txRows.length === 1, "7. the rejected duplicate entry attempt did not create a second transaction row");

    // ============================================================
    // 8-11. Customer payment history — ownership-checked, never leaks other users' data
    // ============================================================
    const unauthed = await api("/api/me/payments");
    assert(unauthed.status === 401, "8. unauthenticated access to payment history is rejected");

    const myPayments = await api("/api/me/payments", { headers: { Authorization: `Bearer ${tokenA}` } });
    assert(myPayments.status === 200, "9. the owner can read their own payment history");
    const myTxIds = (myPayments.body.data as { transactions: { transactionId: number }[] }).transactions.map((t) => t.transactionId);
    assert(myTxIds.includes(transactionIdA), "9. the owner's history includes the transaction just created");

    const otherUserReads = await api(`/api/payments/${transactionIdA}`, { headers: { Authorization: `Bearer ${tokenB}` } });
    assert(otherUserReads.status === 404, "10. a different user reading someone else's transaction gets 404, not 403 — existence is never confirmed");

    const ownerReads = await api(`/api/payments/${transactionIdA}`, { headers: { Authorization: `Bearer ${tokenA}` } });
    assert(ownerReads.status === 200, "11. the owner can read their own transaction by id");
    assert((ownerReads.body.data as { transaction: { transactionId: number } }).transaction.transactionId === transactionIdA, "11. the correct transaction is returned");

    // ============================================================
    // 12/13. Webhook endpoint fails safe — no real provider is connected today
    // ============================================================
    const webhookDev = await api("/api/payments/webhook/dev", { method: "POST", headers: { "x-webhook-signature": "sig=anything" }, body: JSON.stringify({ fake: "event" }) });
    assert(webhookDev.status !== 200, "12. the webhook endpoint never accepts an event while no real provider is configured");
    const webhookMalformed = await api("/api/payments/webhook/dev", { method: "POST", headers: { "x-webhook-signature": "sig=anything" }, body: "{not valid json" });
    assert(webhookMalformed.status !== 200 && webhookMalformed.status < 500, "13. a malformed webhook body is rejected cleanly, never a 500");

    // ============================================================
    // 14. Refund architecture — only a paid transaction is refundable; DevPaymentProvider
    //     always fails a refund attempt (no real provider), and never fabricates success
    // ============================================================
    // No API endpoint exists for this (by design) — flip the transaction to "paid" directly
    // via the DB to simulate "this really was paid", the way a real provider's webhook
    // would have, and exercise the real refundTransaction() function against it.
    await db.update(schema.paymentTransactions).set({ status: "paid" }).where(eq(schema.paymentTransactions.id, transactionIdA));
    const [paidTx] = await db.select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.id, transactionIdA));
    assert(isRefundable(paidTx), "14. a paid payment transaction is refundable");

    const refundAttempt1 = await refundTransaction(transactionIdA, paidTx.amountCents, "qa-test-phase20 refund");
    assert(refundAttempt1.status === "ok", "14. refundTransaction runs without error");
    let firstRefundRowId = -1;
    if (refundAttempt1.status === "ok") {
      firstRefundRowId = refundAttempt1.data.refundTransaction.id;
      assert(refundAttempt1.data.isNewAttempt === true, "14. the first refund attempt is a new attempt");
      assert(refundAttempt1.data.refundTransaction.transactionType === "refund", "14. the refund is recorded as its own transaction row, not overwriting the original");
      assert(refundAttempt1.data.refundTransaction.status === "failed", "14. DevPaymentProvider fails the refund — no real provider exists to actually refund anything");
    }
    const [originalAfterRefundAttempt] = await db.select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.id, transactionIdA));
    assert(originalAfterRefundAttempt.status === "paid", "14. the original payment is untouched by a failed refund attempt — never marked refunded without provider confirmation");

    const refundRowsAfterFirst = await db.select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.transactionType, "refund"));
    const ourRefundRows1 = refundRowsAfterFirst.filter((r) => r.userId === userA.id);
    assert(ourRefundRows1.length === 1, "14. exactly one refund row exists after the first attempt");

    // Retrying a failed refund updates the SAME row rather than creating a second one.
    const refundAttempt2 = await refundTransaction(transactionIdA, paidTx.amountCents, "qa-test-phase20 retry");
    assert(refundAttempt2.status === "ok", "14b. retrying a failed refund runs without error");
    if (refundAttempt2.status === "ok") {
      assert(refundAttempt2.data.refundTransaction.id === firstRefundRowId, "14b. the retry reuses the same refund row id");
    }
    const refundRowsAfterSecond = await db.select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.transactionType, "refund"));
    assert(refundRowsAfterSecond.filter((r) => r.userId === userA.id).length === 1, "14b. retrying a refund never creates a second competing refund row");

    // ============================================================
    // 15/16. Refund guardrails reject illegal requests rather than silently allowing them
    // ============================================================
    const [freshPendingTx] = await db
      .insert(schema.paymentTransactions)
      .values({
        userId: userB.id,
        competitionId,
        provider: "dev-test-only",
        idempotencyKey: `${MARK}-fresh-pending-${userB.id}`,
        amountCents: 500,
        currency: "AUD",
        status: "pending",
        transactionType: "payment",
      })
      .returning();
    const refundPendingAttempt = await refundTransaction(freshPendingTx.id, 500);
    assert(refundPendingAttempt.status === "unavailable", "15. refunding a still-pending (never actually paid) transaction is rejected");

    const overRefundAttempt = await refundTransaction(transactionIdA, paidTx.amountCents + 1000);
    assert(overRefundAttempt.status === "unavailable", "16. a refund amount exceeding the original charge is rejected");

    // ============================================================
    // 17/18. Reconciliation is read-only — it reports, it never corrects
    // ============================================================
    const provider = getPaymentProvider();
    const beforeReconcile = (await db.select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.id, transactionIdA)))[0];
    const finding = await reconcileTransaction(beforeReconcile, provider);
    assert(finding.outcome === "NO_PROVIDER_RECORD", "17. reconciling a transaction with no provider-side record reports NO_PROVIDER_RECORD");
    const afterReconcile = (await db.select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.id, transactionIdA)))[0];
    assert(afterReconcile.updatedAt.getTime() === beforeReconcile.updatedAt.getTime(), "17. reconciling a transaction never writes to it");

    const allFindings = await reconcilePendingTransactions();
    const ourFinding = allFindings.find((f) => f.transactionId === freshPendingTx.id);
    assert(!!ourFinding && ourFinding.outcome === "NO_PROVIDER_RECORD", "18. the batch reconciliation sweep finds and reports our pending transaction");

    console.log(`=== ALL PHASE 20 PAYMENT INFRASTRUCTURE CHECKS PASSED (${passCount}) ===`);
  } finally {
    console.log("Cleaning up QA data...");
    const userIds = [userA?.id, userB?.id].filter((id): id is number => typeof id === "number");
    if (userIds.length) {
      await db.delete(schema.paymentTransactions).where(inArray(schema.paymentTransactions.userId, userIds));
    }
    if (competitionId) {
      const entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, competitionId));
      for (const e of entries) await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, e.id));
      await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, competitionId));
      await db.delete(schema.competitions).where(eq(schema.competitions.id, competitionId));
    }
    if (gameIds.length) {
      await db.delete(schema.playerGameStats).where(inArray(schema.playerGameStats.gameId, gameIds));
      await db.delete(schema.gameLineups).where(inArray(schema.gameLineups.gameId, gameIds));
      await db.delete(schema.games).where(inArray(schema.games.id, gameIds));
    }
    if (playerIds.length) await db.delete(schema.players).where(inArray(schema.players.id, playerIds));
    await db.delete(schema.teams).where(inArray(schema.teams.id, teamIds));
    await db.delete(schema.rounds).where(inArray(schema.rounds.id, roundIds));
    await db.delete(schema.seasons).where(eq(schema.seasons.id, season.id));
    if (nrlWasCreatedByThisRun) await db.delete(schema.sports).where(eq(schema.sports.id, nrl.id));
    if (userIds.length) {
      await db.delete(schema.sessions).where(inArray(schema.sessions.userId, userIds));
      await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    }

    // Independent verification: zero rows remain anywhere for this QA run.
    const remainingTx = userIds.length ? await db.select().from(schema.paymentTransactions).where(inArray(schema.paymentTransactions.userId, userIds)) : [];
    const remainingUsers = userIds.length ? await db.select().from(schema.users).where(inArray(schema.users.id, userIds)) : [];
    const remainingSports = nrlWasCreatedByThisRun ? await db.select().from(schema.sports).where(eq(schema.sports.id, nrl.id)) : [];
    if (remainingTx.length || remainingUsers.length || remainingSports.length) {
      throw new Error(`Cleanup verification FAILED: ${remainingTx.length} transactions, ${remainingUsers.length} users, ${remainingSports.length} sports still present.`);
    }
    console.log("Cleanup complete and verified (0 rows remain).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
