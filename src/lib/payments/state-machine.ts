import type { PaymentStatus } from "@/db/schema";

/**
 * The single source of truth for which payment-status transitions are legal — Phase 20.
 * Every place that changes a payment_transactions.status (or competition_entries.
 * paymentStatus) must go through canTransition() first, rather than each call site
 * deciding for itself what's allowed. Same-state transitions are always permitted
 * (idempotent no-ops); everything else follows the documented lifecycle:
 *
 *   pending  -> paid | failed | cancelled
 *   paid     -> refunded
 *   failed, cancelled, refunded -> (terminal; only themselves)
 *
 * Notably absent, and deliberately so: failed->paid, cancelled->paid, refunded->paid,
 * refunded->failed/cancelled. A terminal negative/refunded state can never be resurrected
 * into "paid" by a normal state mutation — only a brand new transaction (new idempotency
 * key) represents a fresh attempt.
 */
const ALLOWED_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ["pending", "paid", "failed", "cancelled"],
  paid: ["paid", "refunded"],
  failed: ["failed"],
  cancelled: ["cancelled"],
  refunded: ["refunded"],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export class InvalidPaymentTransitionError extends Error {
  constructor(from: PaymentStatus, to: PaymentStatus) {
    super(`Illegal payment status transition: ${from} -> ${to}.`);
    this.name = "InvalidPaymentTransitionError";
  }
}

/** Throws InvalidPaymentTransitionError rather than silently applying a disallowed transition. */
export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransition(from, to)) throw new InvalidPaymentTransitionError(from, to);
}
