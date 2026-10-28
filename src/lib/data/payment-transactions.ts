import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getPaymentProvider } from "@/lib/payments/registry";
import { assertTransition, canTransition } from "@/lib/payments/state-machine";
import { confirmDepositPayment } from "./wallet";
import { safeQuery, type DataResult } from "./result";

export type PaymentTransaction = typeof schema.paymentTransactions.$inferSelect;

/** Deterministic, server-derived — never client-supplied. One payment lifecycle per (user, competition). */
export function buildEntryPaymentIdempotencyKey(userId: number, competitionId: number): string {
  return `payment:${userId}:${competitionId}`;
}

export interface ChargeForEntryResult {
  transaction: PaymentTransaction;
  /** True only the first time this exact charge actually ran a provider call in this request — false on an idempotent replay of an already-pending/paid transaction. */
  isNewAttempt: boolean;
}

/**
 * The one place createEntry (src/lib/data/entries.ts) and the payment pre-flight route
 * (src/app/api/[sport]/rounds/[roundId]/payment/route.ts) go to actually charge — Phase 20.
 * Idempotent by construction:
 *   - an existing pending/paid transaction for this exact (userId, competitionId) is
 *     returned as-is, with NO new provider call — a genuine replay of an already-settled
 *     attempt.
 *   - an existing failed/cancelled transaction is retried in place (same row, same
 *     idempotency key — this IS the "same operation," just attempted again).
 *   - two concurrent first-attempts race on the DB's unique index on idempotencyKey; the
 *     loser's insert is a no-op and it re-reads the winner's row instead of erroring or
 *     inserting a duplicate.
 */
export async function chargeForEntry(userId: number, competitionId: number, amountCents: number): Promise<DataResult<ChargeForEntryResult>> {
  return safeQuery(async () => {
    const db = getDb();
    const idempotencyKey = buildEntryPaymentIdempotencyKey(userId, competitionId);

    const existingRows = await db.select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.idempotencyKey, idempotencyKey)).limit(1);
    const existing = existingRows[0];

    if (existing && (existing.status === "paid" || existing.status === "pending")) {
      return { transaction: existing, isNewAttempt: false };
    }

    const provider = getPaymentProvider();
    const result = await provider.createPayment({
      idempotencyKey,
      amountCents,
      currency: "AUD",
      metadata: { competitionId: String(competitionId), userId: String(userId) },
    });

    if (existing) {
      // Retrying after a previous failed/cancelled attempt — same row, same key.
      assertTransition(existing.status, result.status);
      const [updated] = await db
        .update(schema.paymentTransactions)
        .set({
          status: result.status,
          providerTransactionId: result.providerTransactionId,
          failureCode: result.failureCode ?? null,
          failureMessage: result.failureMessage ?? null,
          updatedAt: new Date(),
          completedAt: result.status === "pending" ? null : new Date(),
        })
        .where(eq(schema.paymentTransactions.id, existing.id))
        .returning();
      return { transaction: updated, isNewAttempt: true };
    }

    const inserted = await db
      .insert(schema.paymentTransactions)
      .values({
        userId,
        competitionId,
        provider: provider.name,
        idempotencyKey,
        amountCents,
        currency: "AUD",
        status: result.status,
        transactionType: "payment",
        providerTransactionId: result.providerTransactionId,
        failureCode: result.failureCode ?? null,
        failureMessage: result.failureMessage ?? null,
        completedAt: result.status === "pending" ? null : new Date(),
      })
      .onConflictDoNothing({ target: schema.paymentTransactions.idempotencyKey })
      .returning();

    if (inserted[0]) return { transaction: inserted[0], isNewAttempt: true };

    // Lost the race to a concurrent identical request — read back the winner's row.
    const [winner] = await db.select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.idempotencyKey, idempotencyKey)).limit(1);
    return { transaction: winner, isNewAttempt: false };
  });
}

export interface UserTransactionSummary {
  transactionId: number;
  competitionId: number | null;
  amountCents: number;
  currency: string;
  status: string;
  transactionType: string;
  createdAt: Date;
}

/** A user's own payment history only — never another user's. */
export async function listTransactionsForUser(userId: number): Promise<DataResult<UserTransactionSummary[]>> {
  return safeQuery(async () => {
    const rows = await getDb()
      .select()
      .from(schema.paymentTransactions)
      .where(eq(schema.paymentTransactions.userId, userId))
      .orderBy(desc(schema.paymentTransactions.createdAt));

    return rows.map((r) => ({
      transactionId: r.id,
      competitionId: r.competitionId,
      amountCents: r.amountCents,
      currency: r.currency,
      status: r.status,
      transactionType: r.transactionType,
      createdAt: r.createdAt,
    }));
  });
}

/** Ownership-checked single-transaction lookup — returns null (not an error) if it belongs to someone else, so the route can 404 without leaking existence. */
export async function getTransactionForUser(transactionId: number, userId: number): Promise<DataResult<PaymentTransaction | null>> {
  return safeQuery(async () => {
    const rows = await getDb()
      .select()
      .from(schema.paymentTransactions)
      .where(and(eq(schema.paymentTransactions.id, transactionId), eq(schema.paymentTransactions.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function getTransactionById(transactionId: number): Promise<DataResult<PaymentTransaction | null>> {
  return safeQuery(async () => {
    const rows = await getDb().select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.id, transactionId)).limit(1);
    return rows[0] ?? null;
  });
}

/** Used by the webhook handler to find which internal transaction a provider event refers to. */
export async function getTransactionByProviderTransactionId(providerTransactionId: string): Promise<DataResult<PaymentTransaction | null>> {
  return safeQuery(async () => {
    const rows = await getDb().select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.providerTransactionId, providerTransactionId)).limit(1);
    return rows[0] ?? null;
  });
}

/**
 * Applies an already-signature-verified webhook event to the matching transaction.
 * Never called unless verifyWebhookSignature succeeded — see the webhook route
 * (src/app/api/payments/webhook/[provider]/route.ts). Respects the same state machine as
 * every other status change (src/lib/payments/state-machine.ts); an illegal transition
 * (e.g. a "paid" event arriving for an already-refunded transaction) is rejected rather
 * than silently applied. The transaction's OWN status update above always happens exactly
 * once per genuine transition (assertTransition rejects an already-applied same-direction
 * repeat only when it would be illegal; a same-state repeat, e.g. "paid" -> "paid", is
 * explicitly allowed by the state machine as an idempotent no-op) — everything below is
 * therefore always safe to re-run on a duplicate/replayed webhook delivery, guarded
 * individually where it needs to be.
 *
 * If this transition is a genuine deposit (competitionId/competitionEntryId both null —
 * only a wallet deposit is ever created that way, an entry-fee charge always has a
 * competitionId) newly reaching "paid" (not already paid — a replayed/duplicate webhook
 * for an already-paid transaction is a no-op here, and confirmDepositPayment's own
 * relatedPaymentTransactionId idempotency guard is a second, DB-level backstop against
 * ever double-crediting even under a genuine race), this is the ONE place the customer's
 * wallet actually gets credited — see depositToWallet's doc comment (src/lib/data/
 * wallet.ts) for why crediting must never happen earlier, on a merely "pending" result.
 *
 * If this transition is for an ENTRY-FEE charge (competitionEntryId is set — createEntry
 * links it right after inserting the entry, src/lib/data/entries.ts) that newly reaches a
 * terminal outcome, this is the ONE place a "pending" entry's paymentStatus/paidAmountCents
 * ever gets corrected to reflect reality once the payment is actually confirmed:
 *   - "paid": the entry's paymentStatus/paidAmountCents are updated to reflect a genuinely
 *     received payment — an entry created while its charge was still "pending" (the
 *     honest, allowed state — see createEntry's doc comment) is not left permanently
 *     stuck showing "pending" once the real payment actually clears.
 *   - "failed" / "cancelled": the entry's paymentStatus is updated to match. It is
 *     deliberately never deleted (a real customer record of what happened, same principle
 *     as void.ts never deleting an entry) — instead settleCompetition
 *     (src/lib/data/settlement.ts) excludes any entry whose paymentStatus is
 *     failed/cancelled/refunded from ever being counted as a PERFECT winner, regardless of
 *     how its selections turned out, since real money was never (or no longer) actually
 *     received for it. This never touches the entry's selections/cutoff — an entry that
 *     was validly created and locked in before cutoff stays exactly as selected; only the
 *     payment-outcome bookkeeping changes, and only ever forward from "pending".
 * Only a plain idempotent SET, safe to apply repeatedly under a duplicate/concurrent
 * webhook delivery — never additive, so re-running it can never double-apply anything.
 */
export async function applyWebhookEventToTransaction(transactionId: number, newStatus: PaymentTransaction["status"]): Promise<DataResult<PaymentTransaction>> {
  return safeQuery(async () => {
    const db = getDb();
    const rows = await db.select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.id, transactionId)).limit(1);
    const existing = rows[0];
    if (!existing) throw new Error(`Transaction ${transactionId} not found.`);
    assertTransition(existing.status, newStatus);
    const [updated] = await db
      .update(schema.paymentTransactions)
      .set({ status: newStatus, updatedAt: new Date(), completedAt: newStatus === "pending" ? existing.completedAt : new Date() })
      .where(eq(schema.paymentTransactions.id, transactionId))
      .returning();

    const isDeposit = updated.competitionId == null && updated.competitionEntryId == null && updated.transactionType === "payment";
    if (isDeposit && newStatus === "paid" && existing.status !== "paid") {
      const creditResult = await confirmDepositPayment(updated.userId, updated.amountCents, updated.id);
      if (creditResult.status === "unavailable") throw new Error(creditResult.message);
    }

    if (updated.competitionEntryId != null && updated.transactionType === "payment") {
      if (newStatus === "paid") {
        await db
          .update(schema.competitionEntries)
          .set({ paymentStatus: "paid", paidAmountCents: updated.amountCents })
          .where(eq(schema.competitionEntries.id, updated.competitionEntryId));
      } else if (newStatus === "failed" || newStatus === "cancelled" || newStatus === "refunded") {
        // "refunded" is a legal transition straight from "paid" (state-machine.ts) — a real
        // provider can deliver this webhook directly (e.g. a customer-initiated chargeback
        // or dispute resolved as a refund), not only via refundTransaction. Missing this
        // branch left a refunded entry permanently showing paymentStatus "paid" forever,
        // which settleCompetition's payment-eligibility filter (src/lib/data/
        // settlement.ts) would never catch — an entry whose fee was fully given back could
        // still win a real prize share. paidAmountCents is deliberately left as the
        // historical amount that WAS paid (same convention as payment_transactions itself,
        // which never zeroes out a refunded charge's own amountCents) — paymentStatus
        // alone is what settlement actually checks.
        await db.update(schema.competitionEntries).set({ paymentStatus: newStatus }).where(eq(schema.competitionEntries.id, updated.competitionEntryId));
      }
    }

    return updated;
  });
}

export { canTransition };
