import type { PaymentStatus } from "@/db/schema";

/**
 * Provider-agnostic payment abstraction — strengthened in Phase 20 to a production-shaped
 * interface (create/get/refund/webhook) while still having no real processor behind it.
 * Mirrors the SportsDataProvider pattern already established in
 * src/lib/sports-data/provider.ts: one interface, swappable implementations, callers never
 * change when a real provider is eventually plugged in.
 */

export interface CreatePaymentRequest {
  /** Server-derived, e.g. "payment:{userId}:{competitionId}" — see src/lib/data/payment-transactions.ts. Never client-supplied. */
  idempotencyKey: string;
  /** Always sourced from competitions.entryFeeCents — never accepted from the client. */
  amountCents: number;
  currency: "AUD";
  /** Small, non-sensitive context only (e.g. competitionId) — never secrets. */
  metadata?: Record<string, string>;
}

export interface ProviderPaymentResult {
  status: PaymentStatus;
  /** Opaque provider-side reference (e.g. a future Stripe PaymentIntent id). Null until a real provider is connected. */
  providerTransactionId: string | null;
  failureCode?: string;
  failureMessage?: string;
  message: string;
}

export interface RefundRequest {
  /** The provider-side reference of the ORIGINAL payment being refunded. */
  providerTransactionId: string;
  /** Must never exceed the original charge — enforced by the refund service, not just the provider. */
  amountCents: number;
  idempotencyKey: string;
}

export interface WebhookVerificationResult {
  valid: boolean;
  reason?: string;
}

/** Deliberately generic/minimal — the real shape depends entirely on whichever provider is eventually chosen. */
export interface WebhookEvent {
  providerEventId: string;
  providerTransactionId: string | null;
  status: PaymentStatus;
}

export interface PaymentProvider {
  readonly name: string;

  /** Creates (or, for a real provider, initiates) a payment. Must be safe to call twice with the same idempotencyKey. */
  createPayment(request: CreatePaymentRequest): Promise<ProviderPaymentResult>;

  /** Looks up a payment's current state directly from the provider — used by reconciliation. Null if the provider has no record of it. */
  getPayment(providerTransactionId: string): Promise<ProviderPaymentResult | null>;

  /** Refunds a previous payment. Must fail safely (never fabricate success) when no real provider is connected. */
  refundPayment(request: RefundRequest): Promise<ProviderPaymentResult>;

  /** Verifies a webhook payload actually came from this provider. Must return invalid (fail closed) if the provider isn't really connected. */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | null): WebhookVerificationResult;

  /** Parses an already-verified webhook body into a normalized event. Never called unless verifyWebhookSignature succeeded. */
  parseWebhookEvent(rawBody: string): WebhookEvent | null;
}
