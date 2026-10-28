import { afterEach, describe, expect, it, vi } from "vitest";
import { DevPaymentProvider } from "./providers/dev-payment-provider";
import { getPaymentProvider, PaymentsMisconfiguredError } from "./registry";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getPaymentProvider (the single place any code asks who to charge through)", () => {
  it("returns the dev/test-only provider when payments are disabled (the default)", () => {
    vi.stubEnv("PAYMENTS_ENABLED", "false");
    expect(getPaymentProvider()).toBeInstanceOf(DevPaymentProvider);
  });

  it("returns the dev provider even if PAYMENT_PROVIDER names something else, as long as PAYMENTS_ENABLED is false", () => {
    vi.stubEnv("PAYMENTS_ENABLED", "false");
    vi.stubEnv("PAYMENT_PROVIDER", "dev");
    expect(getPaymentProvider()).toBeInstanceOf(DevPaymentProvider);
  });

  it("throws rather than silently using the dev simulator when enabled with no provider chosen", () => {
    vi.stubEnv("PAYMENTS_ENABLED", "true");
    vi.stubEnv("PAYMENT_PROVIDER", undefined as unknown as string);
    expect(() => getPaymentProvider()).toThrow(PaymentsMisconfiguredError);
  });

  it("throws for a named provider that has no real implementation yet", () => {
    vi.stubEnv("PAYMENTS_ENABLED", "true");
    vi.stubEnv("PAYMENT_PROVIDER", "dev");
    expect(() => getPaymentProvider()).toThrow(PaymentsMisconfiguredError);
  });
});
