/**
 * Live QA — payment/refund/withdrawal financial-integrity audit. Proves the two genuine
 * defects found and fixed in this pass:
 *
 *   1. updateWithdrawalStatus previously used a read-then-check (non-atomic) terminal-
 *      status guard before calling debitWallet — two concurrent "complete this
 *      withdrawal" admin actions for the SAME withdrawal could both pass the check and
 *      both debit the wallet, double-debiting the customer for one real request. Now
 *      claimed via a single atomic conditional UPDATE, backed by a second, independent
 *      DB-level uniqueness guard on wallet_transactions.relatedWithdrawalId.
 *
 *   2. applyWebhookEventToTransaction (and the dormant refundTransaction architecture)
 *      never handled a "refunded" transition for an entry-fee payment — a refunded
 *      entry would stay showing paymentStatus "paid" forever, meaning it could still be
 *      counted as a PERFECT winner and awarded a real prize share despite its fee being
 *      fully given back.
 *
 * No real payment provider is connected; "paid"/"refunded" transitions are simulated by
 * calling the exact functions a real webhook/provider would trigger — the same pattern
 * already established for the settlement/rollover/entry-confirmation audits this session.
 */
import { getDb, schema } from "../src/db";
import { eq, and } from "drizzle-orm";
import { applyWebhookEventToTransaction } from "../src/lib/data/payment-transactions";
import { updateWithdrawalStatus, requestWithdrawal } from "../src/lib/data/withdrawals";

const db = getDb();
const MARK = `qa-payint-${Date.now()}`;
const API = "http://localhost:3000";

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("PASS: " + msg);
  passed++;
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  // ============================================================
  // Part 1: withdrawal double-debit race
  // ============================================================
  const email = `${MARK}-user@example.com`;
  const reg = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password: "qa-test-password-123", name: "PayInt QA" }) });
  const userId = reg.body.data.user.id as number;
  await db.insert(schema.wallets).values({ userId, balanceCents: 10_000 }).onConflictDoUpdate({ target: schema.wallets.userId, set: { balanceCents: 10_000 } });

  const requestResult = await requestWithdrawal(userId, 2000);
  if (requestResult.status !== "ok") throw new Error("setup: withdrawal request failed");
  const withdrawalId = requestResult.withdrawal.id;

  // Fire 10 concurrent "complete this withdrawal" calls — the exact real-world scenario
  // (two admins, or one admin's retried/double-clicked action) that previously double-
  // debited the wallet.
  const concurrentCompletions = await Promise.all(Array.from({ length: 10 }, () => updateWithdrawalStatus(withdrawalId, "completed")));
  const okCount = concurrentCompletions.filter((r) => r.status === "ok").length;
  const alreadyTerminalCount = concurrentCompletions.filter((r) => r.status === "already_terminal").length;
  assert(okCount === 1, `exactly 1 of 10 concurrent "complete" calls actually wins and debits (got ${okCount})`);
  assert(alreadyTerminalCount === 9, `the other 9 correctly see already_terminal instead of double-debiting (got ${alreadyTerminalCount})`);

  const balanceAfterConcurrent = (await db.select().from(schema.wallets).where(eq(schema.wallets.userId, userId)))[0].balanceCents;
  assert(balanceAfterConcurrent === 8000, `*** the wallet was debited exactly ONCE despite 10 concurrent completions — $100 - $20 = $80 (got ${balanceAfterConcurrent} cents) ***`);

  const withdrawalDebitRows = await db.select().from(schema.walletTransactions).where(and(eq(schema.walletTransactions.userId, userId), eq(schema.walletTransactions.type, "withdrawal")));
  assert(withdrawalDebitRows.length === 1, `exactly one withdrawal-type ledger row exists despite the concurrency storm (got ${withdrawalDebitRows.length})`);
  assert(withdrawalDebitRows[0].relatedWithdrawalId === withdrawalId, "the ledger row is correctly linked back to the withdrawal it paid out");

  // A subsequent explicit retry (e.g. an admin re-clicking after seeing an error) must
  // also be a safe no-op, never a second debit.
  const retryAfterCompleted = await updateWithdrawalStatus(withdrawalId, "completed");
  assert(retryAfterCompleted.status === "already_terminal", "retrying an already-completed withdrawal is rejected, not re-processed");
  const balanceAfterRetry = (await db.select().from(schema.wallets).where(eq(schema.wallets.userId, userId)))[0].balanceCents;
  assert(balanceAfterRetry === 8000, `balance is unchanged after the retry attempt (still ${balanceAfterRetry})`);

  // --- Compensation: claim succeeds but the debit itself fails (insufficient funds by
  // the time completion is attempted) — the withdrawal must NOT get stuck showing
  // "completed" with no real debit ever having happened. ---
  const secondRequestResult = await requestWithdrawal(userId, 5000);
  if (secondRequestResult.status !== "ok") throw new Error("setup: second withdrawal request failed");
  const withdrawalId2 = secondRequestResult.withdrawal.id;
  // Drain the wallet below what's needed to cover this withdrawal, simulating the balance
  // having legitimately changed between request and processing.
  await db.update(schema.wallets).set({ balanceCents: 1000 }).where(eq(schema.wallets.userId, userId));
  const insufficientCompletion = await updateWithdrawalStatus(withdrawalId2, "completed");
  assert(insufficientCompletion.status === "insufficient_funds", `completion correctly fails when the balance no longer covers it (got ${insufficientCompletion.status})`);
  const withdrawal2AfterFailedCompletion = (await db.select().from(schema.withdrawals).where(eq(schema.withdrawals.id, withdrawalId2)))[0];
  assert(withdrawal2AfterFailedCompletion.status === "requested", `*** the withdrawal is correctly reverted to its pre-claim status, never stuck showing "completed" with no debit (got ${withdrawal2AfterFailedCompletion.status}) ***`);
  const balanceUnaffectedByFailedCompletion = (await db.select().from(schema.wallets).where(eq(schema.wallets.userId, userId)))[0].balanceCents;
  assert(balanceUnaffectedByFailedCompletion === 1000, "the balance is completely unaffected by the failed completion attempt");

  // The withdrawal can now be legitimately rejected (a real admin resolution) without any debit.
  const rejectResult = await updateWithdrawalStatus(withdrawalId2, "rejected");
  assert(rejectResult.status === "ok" && rejectResult.withdrawal.status === "rejected", "the withdrawal can still be rejected normally after the failed completion attempt");

  console.log(`\n${passed} checks passed so far (withdrawal integrity)`);

  // ============================================================
  // Part 2: refund-webhook must sync the entry, excluding it from winning
  // ============================================================
  const [sport] = await db.select().from(schema.sports).where(eq(schema.sports.code, "nrl")).limit(1);
  const testYear = 2700 + (Date.now() % 900);
  const [season] = await db.insert(schema.seasons).values({ sportId: sport.id, year: testYear, label: MARK }).returning();
  const [round] = await db.insert(schema.rounds).values({ seasonId: season.id, roundNumber: 1, name: MARK }).returning();
  const [teamA] = await db.insert(schema.teams).values({ sportId: sport.id, slug: `${MARK}-a`, name: "Refund A", shortName: "RFA" }).returning();
  const [teamB] = await db.insert(schema.teams).values({ sportId: sport.id, slug: `${MARK}-b`, name: "Refund B", shortName: "RFB" }).returning();
  const [game] = await db
    .insert(schema.games)
    .values({ roundId: round.id, homeTeamId: teamA.id, awayTeamId: teamB.id, kickoff: new Date(Date.now() + 3600_000), status: "scheduled" })
    .returning();
  const [scorer] = await db.insert(schema.players).values({ sportId: sport.id, teamId: teamA.id, firstName: MARK, lastName: "Scorer", position: "Any" }).returning();
  await db.insert(schema.gameLineups).values({ gameId: game.id, playerId: scorer.id, teamId: teamA.id, position: "Any" });

  const email2 = `${MARK}-entryuser@example.com`;
  const reg2 = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email: email2, password: "qa-test-password-123", name: "Refund Entry QA" }) });
  const auth2 = { Authorization: `Bearer ${reg2.body.data.token}` };
  const createRes = await api(`/api/nrl/rounds/${round.id}/entries`, {
    method: "POST",
    headers: auth2,
    body: JSON.stringify({ selections: [{ gameId: game.id, playerIds: [scorer.id] }] }),
  });
  assert(createRes.status === 201, `entry created for the refund scenario (got ${createRes.status})`);
  const entryId = createRes.body.data.entryId as number;
  const transactionRow = (await db.select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.competitionEntryId, entryId)))[0];

  // Confirm it paid first (a "paid" webhook), then a later "refunded" webhook (a real
  // provider can deliver this directly — e.g. a dispute/chargeback resolved as a refund —
  // without ever going through the dormant refundTransaction() function).
  const paidResult = await applyWebhookEventToTransaction(transactionRow.id, "paid");
  assert(paidResult.status === "ok", "the entry-fee payment confirms paid first");
  const refundedResult = await applyWebhookEventToTransaction(transactionRow.id, "refunded");
  assert(refundedResult.status === "ok", `a refund webhook is applied successfully (${refundedResult.status === "unavailable" ? refundedResult.message : ""})`);

  const entryAfterRefund = (await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId)))[0];
  assert(entryAfterRefund.paymentStatus === "refunded", `*** the entry correctly reflects the refund, never stuck showing "paid" forever (got ${entryAfterRefund.paymentStatus}) ***`);

  // Make the game final with the winning stat — this entry WOULD be PERFECT by picks alone.
  await db.update(schema.games).set({ status: "final", kickoff: new Date(Date.now() - 3600_000), homeScore: 10, awayScore: 6 }).where(eq(schema.games.id, game.id));
  await db.insert(schema.playerGameStats).values({ gameId: game.id, playerId: scorer.id, teamId: teamA.id, tries: 1 });

  const adminReg = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email: `${MARK}-admin@example.com`, password: "qa-test-password-123", name: "PayInt Admin" }) });
  const adminId = adminReg.body.data.user.id as number;
  await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, adminId));
  const adminAuth = { Authorization: `Bearer ${adminReg.body.data.token}` };
  const competitionRow = (await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, round.id)))[0];
  await api(`/api/admin/competitions/${competitionRow.id}/close`, { method: "POST", headers: adminAuth });
  const settleRes = await api(`/api/admin/competitions/${competitionRow.id}/settle`, { method: "POST", headers: adminAuth });
  assert(settleRes.status === 200, `settlement succeeds (${JSON.stringify(settleRes.body).slice(0, 200)})`);

  const entryAfterSettle = (await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId)))[0];
  assert(entryAfterSettle.result === "perfect", "the refunded entry's selection is genuinely correct (perfect by picks alone)");
  assert(entryAfterSettle.prizeAllocationCents === 0, `*** the refunded entry is EXCLUDED from winning despite being selection-perfect (got ${entryAfterSettle.prizeAllocationCents}) ***`);

  // A duplicate refund webhook must be a safe no-op, never re-applying anything unexpected.
  const duplicateRefund = await applyWebhookEventToTransaction(transactionRow.id, "refunded");
  assert(duplicateRefund.status === "ok", "a duplicate refund webhook is accepted as a safe idempotent no-op");
  const entryAfterDuplicateRefund = (await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId)))[0];
  assert(entryAfterDuplicateRefund.paymentStatus === "refunded", "the entry's state is unchanged by the duplicate refund webhook");

  console.log(`\n${passed} total checks passed`);

  // --- cleanup ---
  await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, entryId));
  await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId));
  await db.delete(schema.walletTransactions).where(eq(schema.walletTransactions.userId, userId));
  await db.delete(schema.withdrawals).where(eq(schema.withdrawals.userId, userId));
  await db.delete(schema.paymentTransactions).where(eq(schema.paymentTransactions.userId, userId));
  await db.delete(schema.paymentTransactions).where(eq(schema.paymentTransactions.userId, reg2.body.data.user.id));
  await db.delete(schema.wallets).where(eq(schema.wallets.userId, userId));
  await db.delete(schema.competitions).where(eq(schema.competitions.id, competitionRow.id));
  await db.delete(schema.playerGameStats).where(eq(schema.playerGameStats.gameId, game.id));
  await db.delete(schema.gameLineups).where(eq(schema.gameLineups.gameId, game.id));
  await db.delete(schema.games).where(eq(schema.games.id, game.id));
  await db.delete(schema.players).where(eq(schema.players.id, scorer.id));
  await db.delete(schema.teams).where(eq(schema.teams.id, teamA.id));
  await db.delete(schema.teams).where(eq(schema.teams.id, teamB.id));
  await db.delete(schema.rounds).where(eq(schema.rounds.id, round.id));
  await db.delete(schema.seasons).where(eq(schema.seasons.id, season.id));
  for (const uid of [userId, reg2.body.data.user.id, adminId]) {
    const sessions = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, uid));
    for (const s of sessions) await db.delete(schema.sessions).where(eq(schema.sessions.id, s.id));
    await db.delete(schema.users).where(eq(schema.users.id, uid));
  }
  console.log("cleaned up");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
