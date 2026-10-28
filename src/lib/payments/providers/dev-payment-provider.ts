import type {
  CreatePaymentRequest,
  PaymentProvider,
  ProviderPaymentResult,
  RefundRequest,
  WebhookEvent,
  WebhookVerificationResult,
} from "../types";

/**
 * Development/test-only payment provider — BOUNDARY / PLACEHOLDER ONLY.
 *
 * No real payment processor is connected yet (see docs/phase20-payment-infrastructure.md
 * — Perfect Play's legal classification is still pending specialist review, and real money
 * stays off regardless of this class's behavior; see src/lib/payments/config.ts and
 * registry.ts for the actual gate). This class exists purely so the full flow
 * (buy-in → picks → review → confirmation) can be exercised end-to-end without moving
 * money, and without ever writing a "paid" record that could be mistaken for a real
 * transaction.
 *
 * Every method here is deliberately conservative:
 *  - createPayment always returns "pending", never "paid" — no charge has occurred.
 *  - getPayment always returns null — there is no real provider-side record to look up.
 *  - refundPayment always fails safely — there is nothing real to refund.
 *  - verifyWebhookSignature always reports invalid — there is no real webhook signing
 *    secret, so no webhook can ever be genuinely "from" this provider. Fail closed.
 *  - parseWebhookEvent always returns null — never called in practice, since signature
 *    verification never succeeds, but implemented safely regardless.
 */
export class DevPaymentProvider implements PaymentProvider {
  readonly name = "dev-test-only";

  async createPayment(request: CreatePaymentRequest): Promise<ProviderPaymentResult> {
    return {
      status: "pending",
      providerTransactionId: null,
      message: `Development mode: no live payment provider is connected yet (idempotencyKey=${request.idempotencyKey}). Recorded as pending — no money was charged.`,
    };
  }

  async getPayment(_providerTransactionId: string): Promise<ProviderPaymentResult | null> {
    return null;
  }

  async refundPayment(_request: RefundRequest): Promise<ProviderPaymentResult> {
    return {
      status: "failed",
      providerTransactionId: null,
      failureCode: "no_provider_connected",
      failureMessage: "No real payment provider is connected yet — refunds are not available.",
      message: "Refund not attempted: no live payment provider is connected.",
    };
  }

  verifyWebhookSignature(_rawBody: string, _signatureHeader: string | null): WebhookVerificationResult {
    return { valid: false, reason: "No real payment provider is connected — no webhook can be genuine." };
  }

  parseWebhookEvent(_rawBody: string): WebhookEvent | null {
    return null;
  }
}
