/**
 * Quick smoke test for the Phase 23 wallet data layer (src/lib/data/wallet.ts) against the
 * real dev DB — not the full Phase 23 QA suite (that lands with task #120), just a fast
 * sanity check that deposit/debit/adjustment/idempotency all behave after the
 * wallets/withdrawals schema refactor. Creates one throwaway user, exercises the flow, then
 * deletes everything it created (cascades clean up wallets/wallet_transactions).
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/qa-wallet-smoke.ts
 */
import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";
import { getBalance, debitWallet, depositToWallet, confirmDepositPayment, adjustWalletBalance, listWalletTransactions } from "@/lib/data/wallet";

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`PASS: ${msg}`);
}

async function main() {
  const db = getDb();
  const email = `qa-wallet-smoke-${Date.now()}@example.com`;
  const [user] = await db.insert(schema.users).values({ email, passwordHash: "x", name: "QA Wallet Smoke" }).returning();

  try {
    const zero = await getBalance(user.id);
    assert(zero.status === "ok" && zero.data === 0, "new user starts with a zero-balance wallet");

    // The dev payment provider always reports "pending" (never a real "paid" charge — see
    // DevPaymentProvider's own doc comment) — depositToWallet must NOT credit the wallet
    // on that alone; a real charge only counts once genuinely confirmed. This is the exact
    // bug found and fixed in this audit: crediting on "pending" would have let anyone
    // fabricate spendable balance with zero real payment ever occurring.
    const deposit = await depositToWallet(user.id, 2000);
    assert(deposit.status === "pending", `a "pending" provider result does NOT credit the wallet yet (got status ${deposit.status})`);

    const afterPendingDeposit = await getBalance(user.id);
    assert(afterPendingDeposit.status === "ok" && afterPendingDeposit.data === 0, "balance is still zero while the deposit is only pending — nothing was fabricated");

    const pendingLedgerRows = await listWalletTransactions(user.id);
    assert(pendingLedgerRows.status === "ok" && pendingLedgerRows.data.length === 0, "no wallet_transactions row exists yet for a still-pending deposit");

    // Simulate what a real provider's webhook does once it genuinely confirms payment —
    // this is the ONLY place a deposit is allowed to actually become spendable.
    if (deposit.status !== "pending") throw new Error("unreachable");
    const confirmed = await confirmDepositPayment(user.id, 2000, deposit.transactionId);
    assert(confirmed.status === "ok" && confirmed.data.newBalanceCents === 2000, "confirming the deposit as paid credits the wallet exactly once");

    const afterDeposit = await getBalance(user.id);
    assert(afterDeposit.status === "ok" && afterDeposit.data === 2000, "balance read reflects the confirmed deposit");

    const duplicateConfirm = await confirmDepositPayment(user.id, 2000, deposit.transactionId);
    assert(duplicateConfirm.status === "ok" && duplicateConfirm.data.newBalanceCents === 2000, "confirming the SAME deposit a second time (a replayed webhook) is a safe idempotent no-op, never a double-credit");

    const debit = await debitWallet(user.id, 500, "entry_purchase", "Perfect 2 — 1 Entry");
    assert(debit.status === "ok" && debit.newBalanceCents === 1500, "debit of $5 leaves $15");

    const overDebit = await debitWallet(user.id, 999_999, "entry_purchase", "too much");
    assert(overDebit.status === "insufficient_funds", "debit exceeding balance is rejected, not allowed negative");

    const balanceAfterFailedDebit = await getBalance(user.id);
    assert(balanceAfterFailedDebit.status === "ok" && balanceAfterFailedDebit.data === 1500, "failed debit leaves balance unchanged");

    const credit = await adjustWalletBalance(user.id, 1000, "QA smoke test credit adjustment");
    assert(credit.status === "ok" && credit.newBalanceCents === 2500, "admin credit adjustment of $10 brings balance to $25");

    const debitAdj = await adjustWalletBalance(user.id, -2500, "QA smoke test debit adjustment");
    assert(debitAdj.status === "ok" && debitAdj.newBalanceCents === 0, "admin debit adjustment of $25 zeroes the balance");

    const overAdjust = await adjustWalletBalance(user.id, -100, "should fail");
    assert(overAdjust.status === "insufficient_funds", "admin debit adjustment below zero is rejected");

    const txs = await listWalletTransactions(user.id);
    assert(txs.status === "ok" && txs.data.length === 4, "ledger has exactly 4 rows: deposit, entry_purchase, 2 adjustments (the failed debits wrote nothing)");
    const types = txs.data.map((t) => t.type).sort();
    assert(JSON.stringify(types) === JSON.stringify(["adjustment", "adjustment", "deposit", "entry_purchase"].sort()), `ledger types are exactly as expected, got ${types}`);

    for (const t of txs.data) {
      assert(t.balanceAfterCents - t.balanceBeforeCents === t.amountCents, `row ${t.id}: balanceAfter - balanceBefore === amountCents`);
    }

    const walletRow = await db.select().from(schema.wallets).where(eq(schema.wallets.userId, user.id)).limit(1);
    assert(walletRow.length === 1 && walletRow[0].balanceCents === 0, "exactly one wallets row exists for this user, balance 0");

    console.log("\n=== WALLET SMOKE: all checks passed ===");
  } finally {
    await db.delete(schema.walletTransactions).where(eq(schema.walletTransactions.userId, user.id));
    await db.delete(schema.wallets).where(eq(schema.wallets.userId, user.id));
    await db.delete(schema.paymentTransactions).where(eq(schema.paymentTransactions.userId, user.id));
    await db.delete(schema.users).where(eq(schema.users.id, user.id));

    const leftoverWallet = await db.select().from(schema.wallets).where(eq(schema.wallets.userId, user.id));
    const leftoverUser = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    assert(leftoverWallet.length === 0 && leftoverUser.length === 0, "cleanup verified: zero rows remain for the QA user");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
