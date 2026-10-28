import { getDb, schema } from "@/db";
import { inArray } from "drizzle-orm";
import { getPaymentProvider } from "./registry";
import type { PaymentProvider } from "./types";

export type PaymentTransactionRow = typeof schema.paymentTransactions.$inferSelect;

/**
 * Reconciliation compares Perfect Play's own record of a payment against the payment
 * provider's own record of it. Phase 20 non-negotiable: this NEVER writes anything back —
 * it only reports a finding. Any correction (retrying a charge, marking something failed,
 * escalating a mismatch) is a separate, explicitly-authorized action for a human or a
 * later phase, never something reconciliation does on its own.
 */
export const RECONCILIATION_OUTCOMES = [
  "MATCHED",
  "NO_PROVIDER_RECORD",
  "PROVIDER_PAID_INTERNAL_PENDING",
  "PROVIDER_FAILED_INTERNAL_PENDING",
  "STATUS_MISMATCH",
] as const;
export type ReconciliationOutcome = (typeof RECONCILIATION_OUTCOMES)[number];

export interface ReconciliationFinding {
  transactionId: number;
  outcome: ReconciliationOutcome;
  internalStatus: string;
  providerStatus: string | null;
  detail: string;
}

/**
 * Reconciles a single transaction. Takes the provider as a parameter (rather than always
 * resolving it internally) purely so this stays a pure, unit-testable function — the
 * batch runner below is what wires in the real registry-resolved provider.
 */
export async function reconcileTransaction(transaction: PaymentTransactionRow, provider: PaymentProvider): Promise<ReconciliationFinding> {
  const base = { transactionId: transaction.id, internalStatus: transaction.status };

  if (!transaction.providerTransactionId) {
    return {
      ...base,
      outcome: "NO_PROVIDER_RECORD",
      providerStatus: null,
      detail: "No provider-side transaction id is recorded — expected today, since no real payment provider is connected.",
    };
  }

  const providerRecord = await provider.getPayment(transaction.providerTransactionId);
  if (!providerRecord) {
    return {
      ...base,
      outcome: "NO_PROVIDER_RECORD",
      providerStatus: null,
      detail: `Provider has no record of providerTransactionId=${transaction.providerTransactionId}.`,
    };
  }

  if (providerRecord.status === transaction.status) {
    return { ...base, outcome: "MATCHED", providerStatus: providerRecord.status, detail: "Internal and provider status agree." };
  }

  if (providerRecord.status === "paid" && transaction.status === "pending") {
    return {
      ...base,
      outcome: "PROVIDER_PAID_INTERNAL_PENDING",
      providerStatus: providerRecord.status,
      detail: "Provider reports this payment succeeded, but the internal record is still pending — likely a missed or delayed webhook.",
    };
  }

  if (providerRecord.status === "failed" && transaction.status === "pending") {
    return {
      ...base,
      outcome: "PROVIDER_FAILED_INTERNAL_PENDING",
      providerStatus: providerRecord.status,
      detail: "Provider reports this payment failed, but the internal record is still pending.",
    };
  }

  return {
    ...base,
    outcome: "STATUS_MISMATCH",
    providerStatus: providerRecord.status,
    detail: `Internal status "${transaction.status}" and provider status "${providerRecord.status}" disagree in an unexpected way.`,
  };
}

/**
 * Reconciles every non-terminal (pending) transaction against the provider and returns a
 * read-only report. Terminal transactions (paid/failed/cancelled/refunded) are not swept
 * here — once settled they're immutable, so a batch job checking them repeatedly would
 * just be noise; a targeted reconcileTransaction() call is available for auditing a
 * specific one if ever needed.
 */
export async function reconcilePendingTransactions(): Promise<ReconciliationFinding[]> {
  const db = getDb();
  const provider = getPaymentProvider();
  const pending = await db.select().from(schema.paymentTransactions).where(inArray(schema.paymentTransactions.status, ["pending"]));
  return Promise.all(pending.map((transaction) => reconcileTransaction(transaction, provider)));
}
