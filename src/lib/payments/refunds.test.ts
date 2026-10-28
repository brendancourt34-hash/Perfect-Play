import { describe, expect, it } from "vitest";
import type { schema } from "@/db";
import { isRefundable } from "./refunds";

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
    status: "paid",
    transactionType: "payment",
    failureCode: null,
    failureMessage: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: new Date(),
    ...overrides,
  } as Row;
}

describe("isRefundable (pure — DB-touching refundTransaction itself is covered by the Phase 20 QA script)", () => {
  it("allows a paid payment transaction to be refunded", () => {
    expect(isRefundable(makeRow({ status: "paid", transactionType: "payment" }))).toBe(true);
  });

  it("rejects a pending payment — nothing was actually charged yet", () => {
    expect(isRefundable(makeRow({ status: "pending", transactionType: "payment" }))).toBe(false);
  });

  it("rejects a failed payment — there is nothing to refund", () => {
    expect(isRefundable(makeRow({ status: "failed", transactionType: "payment" }))).toBe(false);
  });

  it("rejects an already-refunded payment — refunds are terminal, never repeatable", () => {
    expect(isRefundable(makeRow({ status: "refunded", transactionType: "payment" }))).toBe(false);
  });

  it("rejects a refund row itself — you cannot refund a refund", () => {
    expect(isRefundable(makeRow({ status: "paid", transactionType: "refund" }))).toBe(false);
  });
});
