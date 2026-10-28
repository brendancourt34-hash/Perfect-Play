import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { safeQuery, type DataResult } from "@/lib/data/result";
import { getPaymentProvider } from "./registry";
import { assertTransition, canTransition } from "./state-machine";
import { logEvent } from "@/lib/monitoring/log";

export type PaymentTransactionRow = typeof schema.paymentTransactions.$inferSelect;

export class RefundNotAllowedError extends Error {
  constructor(reason: string) {
    super(`Refund not allowed: ${reason}`);
    this.name = "RefundNotAllowedError";
  }
}

/** Only an original, fully-paid payment can ever be refunded — never a pending/failed/cancelled charge, and never a refund row itself. */
export function isRefundable(transaction: PaymentTransactionRow): boolean {
  return transaction.transactionType === "payment" && transaction.status === "paid" && canTransition(transaction.status, "refunded");
}

export interface RefundOutcome {
  refundTransaction: PaymentTransactionRow;
  /** True only if this call actually invoked the provider — false on an idempotent replay of an already-recorded refund attempt. */
  isNewAttempt: boolean;
}

/**
 * Refund architecture for Phase 20 — deliberately has NO API route and NO customer or
 * admin UI trigger yet (per the phase brief: "architecture only"). It exists so a future
 * admin action or support workflow has a correct, idempotent primitive to call once one is
 * authorized, rather than that workflow having to reinvent charge-reversal semantics.
 *
 * Every refund attempt is its OWN payment_transactions row (transactionType: "refund"),
 * linked back to the original payment via metadata.originalTransactionId — the original
 * "payment" row is never deleted or overwritten, only transitioned to "refunded" once a
 * provider confirms the refund actually completed. Idempotency key is derived from the
 * original transaction's own key, so retrying a refund of the same payment never double-
 * refunds and never creates a second competing refund row.
 */
export async function refundTransaction(originalTransactionId: number, amountCents: number, reason?: string): Promise<DataResult<RefundOutcome>> {
  return safeQuery(async () => {
    const db = getDb();

    const originalRows = await db.select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.id, originalTransactionId)).limit(1);
    const original = originalRows[0];
    if (!original) throw new RefundNotAllowedError("original transaction not found.");
    if (!isRefundable(original)) throw new RefundNotAllowedError(`transaction ${originalTransactionId} is "${original.status}" (${original.transactionType}) — only a paid payment can be refunded.`);
    if (amountCents <= 0) throw new RefundNotAllowedError("refund amount must be greater than zero.");
    if (amountCents > original.amountCents) throw new RefundNotAllowedError(`refund amount (${amountCents}) cannot exceed the original charge (${original.amountCents}).`);

    const idempotencyKey = `refund:${original.idempotencyKey}`;
    const existingRows = await db.select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.idempotencyKey, idempotencyKey)).limit(1);
    const existing = existingRows[0];
    if (existing && (existing.status === "paid" || existing.status === "pending" || existing.status === "refunded")) {
      return { refundTransaction: existing, isNewAttempt: false };
    }

    const provider = getPaymentProvider();
    const result = original.providerTransactionId
      ? await provider.refundPayment({ providerTransactionId: original.providerTransactionId, amountCents, idempotencyKey })
      : { status: "failed" as const, providerTransactionId: null, failureCode: "no_provider_transaction", failureMessage: "No provider-side transaction exists to refund.", message: "Refund not attempted." };

    let refundRow: PaymentTransactionRow;
    if (existing) {
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
      refundRow = updated;
    } else {
      const inserted = await db
        .insert(schema.paymentTransactions)
        .values({
          userId: original.userId,
          competitionId: original.competitionId,
          competitionEntryId: original.competitionEntryId,
          provider: provider.name,
          idempotencyKey,
          amountCents,
          currency: original.currency,
          status: result.status,
          transactionType: "refund",
          providerTransactionId: result.providerTransactionId,
          failureCode: result.failureCode ?? null,
          failureMessage: result.failureMessage ?? null,
          metadata: { originalTransactionId: String(original.id), ...(reason ? { reason } : {}) },
          completedAt: result.status === "pending" ? null : new Date(),
        })
        .onConflictDoNothing({ target: schema.paymentTransactions.idempotencyKey })
        .returning();
      if (inserted[0]) {
        refundRow = inserted[0];
      } else {
        const [winner] = await db.select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.idempotencyKey, idempotencyKey)).limit(1);
        return { refundTransaction: winner, isNewAttempt: false };
      }
    }

    // Only a provider-confirmed refund ever moves the ORIGINAL payment to "refunded" —
    // a failed/pending refund attempt leaves the original charge exactly as it was.
    if (result.status === "refunded") {
      assertTransition(original.status, "refunded");
      await db.update(schema.paymentTransactions).set({ status: "refunded", updatedAt: new Date(), completedAt: new Date() }).where(eq(schema.paymentTransactions.id, original.id));

      // If this was an entry-fee payment (not a wallet deposit — a deposit's
      // paymentTransactions row never has competitionEntryId set), the linked entry must
      // reflect the refund too. Without this, a fully-refunded entry would still show
      // paymentStatus "paid" forever, and settleCompetition's payment-eligibility filter
      // (src/lib/data/settlement.ts) would never catch it — it could still win a real
      // prize share despite its fee being fully given back. Same fix, same reasoning, as
      // applyWebhookEventToTransaction's own "refunded" handling (payment-transactions.ts)
      // — a real provider's refund confirmation can arrive through either path.
      if (original.competitionEntryId != null) {
        await db.update(schema.competitionEntries).set({ paymentStatus: "refunded" }).where(eq(schema.competitionEntries.id, original.competitionEntryId));
      }
      logEvent("refund_issued", { userId: original.userId, originalTransactionId: original.id, refundTransactionId: refundRow.id, amountCents });
    } else if (result.status === "failed") {
      logEvent(
        "refund_anomaly",
        { userId: original.userId, originalTransactionId: original.id, refundTransactionId: refundRow.id, failureCode: result.failureCode ?? undefined },
        "warn",
      );
    }

    return { refundTransaction: refundRow, isNewAttempt: true };
  });
}
