import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { WalletTransactionType } from "@/db/schema";
import { getPaymentProvider } from "@/lib/payments/registry";
import { logEvent } from "@/lib/monitoring/log";
import { safeQuery, type DataResult } from "./result";

export type WalletTransaction = typeof schema.walletTransactions.$inferSelect;

/** Reads (or lazily creates) the wallet row for a user — every user gets a zero-balance wallet on first touch, so callers never have to special-case "no wallet yet". */
async function getOrCreateWallet(userId: number): Promise<{ id: number; balanceCents: number }> {
  const db = getDb();
  const existing = await db.select({ id: schema.wallets.id, balanceCents: schema.wallets.balanceCents }).from(schema.wallets).where(eq(schema.wallets.userId, userId)).limit(1);
  if (existing[0]) return existing[0];

  const inserted = await db
    .insert(schema.wallets)
    .values({ userId, balanceCents: 0 })
    .onConflictDoNothing({ target: schema.wallets.userId })
    .returning({ id: schema.wallets.id, balanceCents: schema.wallets.balanceCents });
  if (inserted[0]) return inserted[0];

  // Lost a concurrent race to create the wallet — the winner's row now exists.
  const winner = await db.select({ id: schema.wallets.id, balanceCents: schema.wallets.balanceCents }).from(schema.wallets).where(eq(schema.wallets.userId, userId)).limit(1);
  if (!winner[0]) throw new Error(`Wallet for user ${userId} could not be created or found.`);
  return winner[0];
}

export async function getBalance(userId: number): Promise<DataResult<number>> {
  return safeQuery(async () => {
    const wallet = await getOrCreateWallet(userId);
    return wallet.balanceCents;
  });
}

export async function listWalletTransactions(userId: number): Promise<DataResult<WalletTransaction[]>> {
  return safeQuery(() =>
    getDb().select().from(schema.walletTransactions).where(eq(schema.walletTransactions.userId, userId)).orderBy(desc(schema.walletTransactions.createdAt)),
  );
}

/**
 * Credits the wallet — always inside one atomic UPDATE that both moves the balance AND
 * writes the ledger row, so the two can never drift. `idempotencyKey` (mapped to
 * relatedPaymentTransactionId's unique index) makes calling this twice for the same
 * deposit a safe no-op rather than a double credit.
 */
async function creditWallet(
  userId: number,
  amountCents: number,
  type: WalletTransactionType,
  description: string,
  opts: { relatedPaymentTransactionId?: number; relatedPrizeEntryId?: number; relatedCompetitionId?: number; relatedEntryIds?: number[] } = {},
): Promise<DataResult<{ transaction: WalletTransaction; newBalanceCents: number }>> {
  return safeQuery(async () => {
    if (amountCents <= 0) throw new Error("Credit amount must be positive.");
    const db = getDb();

    // Idempotency: if this exact payment transaction (deposit) or entry (prize winnings)
    // already produced a wallet credit, return it unchanged instead of crediting again.
    // relatedPrizeEntryId is what makes it safe for settlement.ts to retry a credit that
    // failed partway the first time — an entry can win at most once, ever, so this key is
    // just as durable a de-dup guarantee as relatedPaymentTransactionId is for deposits.
    if (opts.relatedPaymentTransactionId) {
      const existing = await db
        .select()
        .from(schema.walletTransactions)
        .where(eq(schema.walletTransactions.relatedPaymentTransactionId, opts.relatedPaymentTransactionId))
        .limit(1);
      if (existing[0]) {
        const wallet = await getOrCreateWallet(userId);
        return { transaction: existing[0], newBalanceCents: wallet.balanceCents };
      }
    }
    if (opts.relatedPrizeEntryId) {
      const existing = await db
        .select()
        .from(schema.walletTransactions)
        .where(eq(schema.walletTransactions.relatedPrizeEntryId, opts.relatedPrizeEntryId))
        .limit(1);
      if (existing[0]) {
        const wallet = await getOrCreateWallet(userId);
        return { transaction: existing[0], newBalanceCents: wallet.balanceCents };
      }
    }

    await getOrCreateWallet(userId);

    const updated = await db
      .update(schema.wallets)
      .set({ balanceCents: sql`${schema.wallets.balanceCents} + ${amountCents}`, updatedAt: new Date() })
      .where(eq(schema.wallets.userId, userId))
      .returning({ balanceCents: schema.wallets.balanceCents });
    if (!updated[0]) throw new Error(`Wallet for user ${userId} not found.`);
    const newBalanceCents = updated[0].balanceCents;
    const balanceBeforeCents = newBalanceCents - amountCents;

    const inserted = await db
      .insert(schema.walletTransactions)
      .values({
        userId,
        type,
        amountCents,
        currency: "AUD",
        balanceBeforeCents,
        balanceAfterCents: newBalanceCents,
        description,
        relatedPaymentTransactionId: opts.relatedPaymentTransactionId,
        relatedPrizeEntryId: opts.relatedPrizeEntryId,
        relatedCompetitionId: opts.relatedCompetitionId,
        relatedEntryIds: opts.relatedEntryIds,
      })
      // Exactly one of these two idempotency keys is ever set per call site (deposits vs.
      // prize credits) — whichever is present is the real conflict target; when neither is
      // set (refunds, package purchases) this targets a column that's NULL on every row,
      // which Postgres unique indexes never treat as a conflict, so it's a harmless no-op
      // target and behaves as a plain insert, exactly as before this field existed.
      .onConflictDoNothing({ target: opts.relatedPrizeEntryId ? schema.walletTransactions.relatedPrizeEntryId : schema.walletTransactions.relatedPaymentTransactionId })
      .returning();

    if (inserted[0]) {
      logEvent("wallet_credit", { userId, amountCents, type, transactionId: inserted[0].id });
      return { transaction: inserted[0], newBalanceCents };
    }

    // Lost a concurrent race for the same deposit/prize entry — undo our own balance bump
    // and read back the winner's already-applied credit instead of double-crediting.
    await db.update(schema.wallets).set({ balanceCents: sql`${schema.wallets.balanceCents} - ${amountCents}`, updatedAt: new Date() }).where(eq(schema.wallets.userId, userId));
    const winner = opts.relatedPrizeEntryId
      ? await db.select().from(schema.walletTransactions).where(eq(schema.walletTransactions.relatedPrizeEntryId, opts.relatedPrizeEntryId)).limit(1)
      : await db.select().from(schema.walletTransactions).where(eq(schema.walletTransactions.relatedPaymentTransactionId, opts.relatedPaymentTransactionId!)).limit(1);
    const wallet = await getOrCreateWallet(userId);
    return { transaction: winner[0], newBalanceCents: wallet.balanceCents };
  });
}

export type DebitWalletResult =
  | { status: "ok"; transaction: WalletTransaction; newBalanceCents: number; /** True when this call found and reused an existing transaction (relatedWithdrawalId or idempotencyKey already recorded) rather than performing a fresh debit — callers that create side effects (e.g. entries) after debiting must skip them on true. */ alreadyExisted: boolean }
  | { status: "insufficient_funds"; balanceCents: number; requiredCents: number }
  | { status: "unavailable"; message: string };

/**
 * Debits the wallet atomically — the single conditional UPDATE
 * (`WHERE balance_cents >= amount`) is what makes this race-safe under concurrent
 * purchase attempts: only one of two simultaneous debits for the same user can ever
 * succeed if the balance can't cover both, with the balance never going negative.
 *
 * `relatedWithdrawalId`, when passed, is a second, independent idempotency guarantee
 * (mirroring relatedPaymentTransactionId/relatedPrizeEntryId's exact pattern via
 * wallet_transactions' own unique index) on top of updateWithdrawalStatus's atomic
 * status-claim (src/lib/data/withdrawals.ts): even if that claim were ever bypassed or a
 * future caller forgot to use it, the database itself refuses to record two debits for
 * the same withdrawal — a genuine defect found and fixed in this audit, where two
 * concurrent "complete this withdrawal" admin actions could previously both pass the
 * (non-atomic) terminal-status check and both debit the wallet for one real request.
 */
export async function debitWallet(
  userId: number,
  amountCents: number,
  type: WalletTransactionType,
  description: string,
  opts: { relatedCompetitionId?: number; relatedEntryIds?: number[]; relatedWithdrawalId?: number; idempotencyKey?: string } = {},
): Promise<DebitWalletResult> {
  const result = await safeQuery(async () => {
    if (amountCents <= 0) throw new Error("Debit amount must be positive.");
    const db = getDb();
    await getOrCreateWallet(userId);

    // Two independent idempotency domains share this same guard shape: relatedWithdrawalId
    // (an existing row created before the debit) and idempotencyKey (a client-supplied key
    // with no pre-existing row — e.g. an entry-package purchase, where a literal retried
    // request, or two concurrent taps of "Enter", must never debit or create entries twice).
    if (opts.relatedWithdrawalId) {
      const existingTx = await db.select().from(schema.walletTransactions).where(eq(schema.walletTransactions.relatedWithdrawalId, opts.relatedWithdrawalId)).limit(1);
      if (existingTx[0]) {
        const wallet = await getOrCreateWallet(userId);
        return { insufficient: false as const, transaction: existingTx[0], newBalanceCents: wallet.balanceCents, alreadyExisted: true as const };
      }
    }
    if (opts.idempotencyKey) {
      const existingTx = await db.select().from(schema.walletTransactions).where(eq(schema.walletTransactions.idempotencyKey, opts.idempotencyKey)).limit(1);
      if (existingTx[0]) {
        const wallet = await getOrCreateWallet(userId);
        return { insufficient: false as const, transaction: existingTx[0], newBalanceCents: wallet.balanceCents, alreadyExisted: true as const };
      }
    }

    const updated = await db
      .update(schema.wallets)
      .set({ balanceCents: sql`${schema.wallets.balanceCents} - ${amountCents}`, updatedAt: new Date() })
      .where(and(eq(schema.wallets.userId, userId), sql`${schema.wallets.balanceCents} >= ${amountCents}`))
      .returning({ balanceCents: schema.wallets.balanceCents });

    if (!updated[0]) {
      const current = await db.select({ balanceCents: schema.wallets.balanceCents }).from(schema.wallets).where(eq(schema.wallets.userId, userId)).limit(1);
      return { insufficient: true as const, balanceCents: current[0]?.balanceCents ?? 0 };
    }

    const newBalanceCents = updated[0].balanceCents;
    const balanceBeforeCents = newBalanceCents + amountCents;

    const values = {
      userId,
      type,
      amountCents: -amountCents,
      currency: "AUD",
      balanceBeforeCents,
      balanceAfterCents: newBalanceCents,
      description,
      relatedCompetitionId: opts.relatedCompetitionId,
      relatedEntryIds: opts.relatedEntryIds,
      relatedWithdrawalId: opts.relatedWithdrawalId,
      idempotencyKey: opts.idempotencyKey,
    };

    const conflictTarget = opts.relatedWithdrawalId
      ? schema.walletTransactions.relatedWithdrawalId
      : opts.idempotencyKey
        ? schema.walletTransactions.idempotencyKey
        : null;

    if (!conflictTarget) {
      const [transaction] = await db.insert(schema.walletTransactions).values(values).returning();
      return { insufficient: false as const, transaction, newBalanceCents, alreadyExisted: false as const };
    }

    const inserted = await db.insert(schema.walletTransactions).values(values).onConflictDoNothing({ target: conflictTarget }).returning();
    if (inserted[0]) return { insufficient: false as const, transaction: inserted[0], newBalanceCents, alreadyExisted: false as const };

    // Lost a concurrent race for the same withdrawal/idempotency key — undo our own
    // balance deduction and read back the winner's already-applied debit instead of
    // double-debiting.
    await db.update(schema.wallets).set({ balanceCents: sql`${schema.wallets.balanceCents} + ${amountCents}`, updatedAt: new Date() }).where(eq(schema.wallets.userId, userId));
    const winner = opts.relatedWithdrawalId
      ? await db.select().from(schema.walletTransactions).where(eq(schema.walletTransactions.relatedWithdrawalId, opts.relatedWithdrawalId)).limit(1)
      : await db.select().from(schema.walletTransactions).where(eq(schema.walletTransactions.idempotencyKey, opts.idempotencyKey!)).limit(1);
    const wallet = await getOrCreateWallet(userId);
    return { insufficient: false as const, transaction: winner[0], newBalanceCents: wallet.balanceCents, alreadyExisted: true as const };
  });

  if (result.status === "unavailable") return result;
  if (result.data.insufficient) {
    logEvent("wallet_debit", { userId, amountCents, type, status: "insufficient_funds" }, "warn");
    return { status: "insufficient_funds", balanceCents: result.data.balanceCents, requiredCents: amountCents };
  }
  logEvent("wallet_debit", {
    userId,
    amountCents,
    type,
    transactionId: result.data.transaction.id,
    alreadyExisted: result.data.alreadyExisted,
  });
  return { status: "ok", transaction: result.data.transaction, newBalanceCents: result.data.newBalanceCents, alreadyExisted: result.data.alreadyExisted };
}

export type DepositResult =
  | { status: "ok"; providerStatus: string; newBalanceCents: number }
  | { status: "pending"; transactionId: number; message: string }
  | { status: "failed"; message: string }
  | { status: "unavailable"; message: string };

/**
 * Deposits to the wallet via the existing (dev-only) payment provider abstraction — real
 * money remains disabled (Phase 20).
 *
 * Critical: the wallet is credited ONLY when the provider reports the payment as
 * genuinely "paid" — never on "pending". This mirrors the exact rule createEntry already
 * uses for a direct entry charge (src/lib/data/entries.ts sets paidAmountCents to the
 * real fee ONLY when transaction.status === "paid", leaving it null for "pending"): a
 * "pending" result means no money has actually moved yet, so nothing should be treated as
 * spendable yet either. A previous version of this function credited the wallet on
 * "pending" too — with DevPaymentProvider.createPayment always returning "pending" and
 * never anything else, that meant every deposit call fabricated real spendable balance
 * with zero payment ever confirmed, and would have done the same in production against
 * any real provider whose payment methods return "pending" (e.g. bank transfers) — a
 * customer could spend, and even win and (once withdrawals are enabled) withdraw, money
 * that was never actually paid in, with no compensating debit if the "pending" payment
 * later genuinely failed. A "pending" deposit here now records the attempt honestly and
 * returns without touching the balance; the wallet is only credited later, once a real
 * provider webhook confirms "paid" (see applyWebhookEventToTransaction below), using the
 * same relatedPaymentTransactionId idempotency key so a duplicate/replayed webhook can
 * never double-credit.
 */
export async function depositToWallet(userId: number, amountCents: number): Promise<DepositResult> {
  if (amountCents <= 0) return { status: "failed", message: "Deposit amount must be positive." };

  const idempotencyKey = `wallet-deposit:${userId}:${crypto.randomUUID()}`;
  let providerResult;
  try {
    providerResult = await getPaymentProvider().createPayment({ idempotencyKey, amountCents, currency: "AUD" });
  } catch (error) {
    return { status: "unavailable", message: error instanceof Error ? error.message : "Payment provider unavailable." };
  }

  if (providerResult.status === "failed" || providerResult.status === "cancelled") {
    return { status: "failed", message: providerResult.failureMessage ?? providerResult.message };
  }

  const paymentTxResult = await safeQuery(async () => {
    const db = getDb();
    const [row] = await db
      .insert(schema.paymentTransactions)
      .values({
        userId,
        provider: getPaymentProvider().name,
        idempotencyKey,
        amountCents,
        currency: "AUD",
        status: providerResult.status,
        transactionType: "payment",
        providerTransactionId: providerResult.providerTransactionId,
        completedAt: providerResult.status === "pending" ? null : new Date(),
      })
      .returning();
    return row;
  });
  if (paymentTxResult.status === "unavailable") return paymentTxResult;

  if (providerResult.status !== "paid") {
    return {
      status: "pending",
      transactionId: paymentTxResult.data.id,
      message: "Deposit recorded — awaiting payment confirmation. Your balance will update once the payment is confirmed.",
    };
  }

  const creditResult = await creditWallet(userId, amountCents, "deposit", "Perfect Play Balance deposit", {
    relatedPaymentTransactionId: paymentTxResult.data.id,
  });
  if (creditResult.status === "unavailable") return creditResult;

  return { status: "ok", providerStatus: providerResult.status, newBalanceCents: creditResult.data.newBalanceCents };
}

/** Credits winnings back to the wallet — used by settlement once a prize is allocated. */
export async function creditPrizeWinnings(userId: number, amountCents: number, competitionId: number, entryId: number): Promise<DataResult<{ transaction: WalletTransaction; newBalanceCents: number }>> {
  return creditWallet(userId, amountCents, "winning_credit", "Perfect Play prize winnings", {
    relatedCompetitionId: competitionId,
    relatedEntryIds: [entryId],
    relatedPrizeEntryId: entryId,
  });
}

/** Refunds an amount back to the wallet (e.g. a cancelled round) — an internal credit, no provider call. */
export async function refundToWallet(userId: number, amountCents: number, competitionId: number, entryIds: number[], reason: string): Promise<DataResult<{ transaction: WalletTransaction; newBalanceCents: number }>> {
  return creditWallet(userId, amountCents, "refund", reason, { relatedCompetitionId: competitionId, relatedEntryIds: entryIds });
}

/**
 * Credits the wallet once a deposit that started "pending" (see depositToWallet) is
 * confirmed genuinely "paid" — called from applyWebhookEventToTransaction
 * (src/lib/data/payment-transactions.ts) when a real provider webhook reports the
 * transition. Idempotent via the same relatedPaymentTransactionId unique constraint every
 * deposit credit already uses, so a duplicate/replayed webhook delivery for the same
 * transaction can never double-credit.
 */
export async function confirmDepositPayment(userId: number, amountCents: number, paymentTransactionId: number): Promise<DataResult<{ transaction: WalletTransaction; newBalanceCents: number }>> {
  return creditWallet(userId, amountCents, "deposit", "Perfect Play Balance deposit", { relatedPaymentTransactionId: paymentTransactionId });
}

/** Links a now-created batch of entries back to the wallet debit that paid for them — called once, right after the entries are inserted. Never touches amount/balance fields, only the descriptive relatedEntryIds column. */
export async function linkWalletTransactionToEntries(transactionId: number, entryIds: number[]): Promise<DataResult<void>> {
  return safeQuery(async () => {
    await getDb().update(schema.walletTransactions).set({ relatedEntryIds: entryIds }).where(eq(schema.walletTransactions.id, transactionId));
  });
}

export type AdjustWalletResult =
  | { status: "ok"; transaction: WalletTransaction; newBalanceCents: number }
  | { status: "insufficient_funds"; balanceCents: number; requiredCents: number }
  | { status: "unavailable"; message: string };

/**
 * Admin-only manual balance correction — never a silent balance write. `amountCents` may be
 * positive (credit) or negative (debit); `reason` is mandatory and stored on the ledger row
 * so every adjustment is fully auditable (who, why, before/after balance).
 */
export async function adjustWalletBalance(userId: number, amountCents: number, reason: string): Promise<AdjustWalletResult> {
  if (amountCents === 0) return { status: "unavailable", message: "Adjustment amount must be non-zero." };
  if (!reason.trim()) return { status: "unavailable", message: "An adjustment reason is required." };

  if (amountCents > 0) {
    const result = await creditWallet(userId, amountCents, "adjustment", reason);
    if (result.status === "unavailable") return result;
    return { status: "ok", transaction: result.data.transaction, newBalanceCents: result.data.newBalanceCents };
  }

  return debitWallet(userId, -amountCents, "adjustment", reason);
}
