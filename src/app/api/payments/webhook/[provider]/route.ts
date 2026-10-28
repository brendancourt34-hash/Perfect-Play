import { apiError, apiOk } from "@/lib/api/response";
import { applyWebhookEventToTransaction, getTransactionByProviderTransactionId } from "@/lib/data/payment-transactions";
import { getPaymentConfig } from "@/lib/payments/config";
import { getPaymentProvider } from "@/lib/payments/registry";

/**
 * Provider-neutral webhook receiver — Phase 20. There is no authentication header check
 * here beyond the provider's own signature, by design: a webhook comes from the payment
 * provider itself, not from a logged-in Perfect Play user, so the ONLY thing that can ever
 * authorize an update through this route is a verified provider signature.
 *
 * Today that verification can never succeed: DevPaymentProvider.verifyWebhookSignature
 * always returns invalid (src/lib/payments/providers/dev-payment-provider.ts), because no
 * real provider is connected yet. That means this endpoint currently rejects every single
 * request it receives, including genuine-looking ones — which is exactly the fail-safe
 * behavior Phase 20 requires: no live provider, so nothing this route sees is real.
 */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerParam } = await params;
  const config = getPaymentConfig();

  // The URL's provider segment must match the server's actually-configured provider. This
  // isn't itself an auth check — it just avoids distinguishing "wrong provider name" from
  // "misconfigured" with different responses, which would leak configuration details.
  if (config.provider === "none" || providerParam !== config.provider) {
    return apiError(404, "Unknown webhook provider.");
  }

  let provider;
  try {
    provider = getPaymentProvider();
  } catch {
    return apiError(404, "Unknown webhook provider.");
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-webhook-signature");

  const verification = provider.verifyWebhookSignature(rawBody, signatureHeader);
  if (!verification.valid) {
    return apiError(401, "Invalid webhook signature.");
  }

  const event = provider.parseWebhookEvent(rawBody);
  if (!event || !event.providerTransactionId) {
    return apiError(400, "Malformed webhook payload.");
  }

  const lookup = await getTransactionByProviderTransactionId(event.providerTransactionId);
  if (lookup.status === "unavailable") return apiError(503, "Temporarily unavailable.");
  if (!lookup.data) return apiError(404, "Unknown transaction.");

  const applied = await applyWebhookEventToTransaction(lookup.data.id, event.status);
  if (applied.status === "unavailable") return apiError(409, applied.message);

  return apiOk({ received: true });
}
