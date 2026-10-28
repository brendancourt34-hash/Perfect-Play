import { describe, expect, it } from "vitest";
import type { schema } from "@/db";
import { reconcileTransaction } from "./reconciliation";
import type { PaymentProvider, ProviderPaymentResult } from "./types";

type Row = typeof schema.paymentTransactions.$inferSelect;

function makeRow(overrides: Partial<Row>): Row {
  return {
    id: 1,
    userId: 1,
    competitionEntryId: null,
    competitionId: 1,
    provider: "dev-test-only",
    providerTransactionId: null,
    idempotencyKey: "payment:1:1",
    amountCents: 500,
    currency: "AUD",
    status: "pending",
    transactionType: "payment",
    failureCode: null,
    failureMessage: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    ...overrides,
  } as Row;
}

function fakeProvider(getPaymentResult: ProviderPaymentResult | null): PaymentProvider {
  return {
    name: "fake",
    createPayment: async () => {
      throw new Error("not used in these tests");
    },
    getPayment: async () => getPaymentResult,
    refundPayment: async () => {
      throw new Error("not used in these tests");
    },
    verifyWebhookSignature: () => ({ valid: false }),
    parseWebhookEvent: () => null,
  };
}

describe("reconcileTransaction (pure — DB-touching reconcilePendingTransactions is covered by the Phase 20 QA script)", () => {
  it("reports NO_PROVIDER_RECORD when the transaction never got a provider id — today's expected state with no real provider connected", async () => {
    const finding = await reconcileTransaction(makeRow({ providerTransactionId: null }), fakeProvider(null));
    expect(finding.outcome).toBe("NO_PROVIDER_RECORD");
  });

  it("reports NO_PROVIDER_RECORD when the provider has no record of a stored provider id", async () => {
    const finding = await reconcileTransaction(makeRow({ providerTransactionId: "pt_123" }), fakeProvider(null));
    expect(finding.outcome).toBe("NO_PROVIDER_RECORD");
  });

  it("reports MATCHED when internal and provider status agree", async () => {
    const finding = await reconcileTransaction(
      makeRow({ providerTransactionId: "pt_123", status: "paid" }),
      fakeProvider({ status: "paid", providerTransactionId: "pt_123", message: "ok" }),
    );
    expect(finding.outcome).toBe("MATCHED");
  });

  it("reports PROVIDER_PAID_INTERNAL_PENDING when the provider is ahead of our own record", async () => {
    const finding = await reconcileTransaction(
      makeRow({ providerTransactionId: "pt_123", status: "pending" }),
      fakeProvider({ status: "paid", providerTransactionId: "pt_123", message: "ok" }),
    );
    expect(finding.outcome).toBe("PROVIDER_PAID_INTERNAL_PENDING");
  });

  it("reports PROVIDER_FAILED_INTERNAL_PENDING when the provider failed but we never recorded it", async () => {
    const finding = await reconcileTransaction(
      makeRow({ providerTransactionId: "pt_123", status: "pending" }),
      fakeProvider({ status: "failed", providerTransactionId: "pt_123", message: "failed" }),
    );
    expect(finding.outcome).toBe("PROVIDER_FAILED_INTERNAL_PENDING");
  });

  it("reports STATUS_MISMATCH for any other disagreement, e.g. internal paid but provider refunded", async () => {
    const finding = await reconcileTransaction(
      makeRow({ providerTransactionId: "pt_123", status: "paid" }),
      fakeProvider({ status: "refunded", providerTransactionId: "pt_123", message: "refunded" }),
    );
    expect(finding.outcome).toBe("STATUS_MISMATCH");
  });

  it("never mutates the transaction it was given — reconciliation only reports, never corrects", async () => {
    const row = makeRow({ providerTransactionId: "pt_123", status: "pending" });
    const snapshot = { ...row };
    await reconcileTransaction(row, fakeProvider({ status: "paid", providerTransactionId: "pt_123", message: "ok" }));
    expect(row).toEqual(snapshot);
  });
});
