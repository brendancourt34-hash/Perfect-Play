import { describe, expect, it } from "vitest";
import { DevPaymentProvider } from "./dev-payment-provider";

describe("DevPaymentProvider (dev/test-only placeholder)", () => {
  it("never returns 'paid' from createPayment — no real charge has occurred", async () => {
    const provider = new DevPaymentProvider();
    const result = await provider.createPayment({ idempotencyKey: "test-key-1", amountCents: 500, currency: "AUD" });
    expect(result.status).toBe("pending");
    expect(result.status).not.toBe("paid");
  });

  it("never fabricates a provider transaction id, since no real provider is connected", async () => {
    const provider = new DevPaymentProvider();
    const result = await provider.createPayment({ idempotencyKey: "test-key-2", amountCents: 500, currency: "AUD" });
    expect(result.providerTransactionId).toBeNull();
  });

  it("clearly labels the createPayment result as development-only, not a real transaction", async () => {
    const provider = new DevPaymentProvider();
    const result = await provider.createPayment({ idempotencyKey: "test-key-3", amountCents: 500, currency: "AUD" });
    expect(result.message).toMatch(/development mode/i);
    expect(result.message).toMatch(/no money was charged/i);
  });

  it("getPayment always returns null — there is no real provider-side record", async () => {
    const provider = new DevPaymentProvider();
    expect(await provider.getPayment("pt_fake_123")).toBeNull();
  });

  it("refundPayment always fails safely rather than fabricating a successful refund", async () => {
    const provider = new DevPaymentProvider();
    const result = await provider.refundPayment({ providerTransactionId: "pt_fake_123", amountCents: 500, idempotencyKey: "refund-key-1" });
    expect(result.status).toBe("failed");
    expect(result.failureCode).toBe("no_provider_connected");
  });

  it("verifyWebhookSignature always reports invalid — no webhook can be genuine without a real provider", () => {
    const provider = new DevPaymentProvider();
    expect(provider.verifyWebhookSignature("{}", "sig=anything").valid).toBe(false);
    expect(provider.verifyWebhookSignature("{}", null).valid).toBe(false);
  });

  it("parseWebhookEvent always returns null", () => {
    const provider = new DevPaymentProvider();
    expect(provider.parseWebhookEvent("{}")).toBeNull();
  });
});
