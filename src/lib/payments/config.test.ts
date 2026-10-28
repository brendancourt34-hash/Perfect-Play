import { afterEach, describe, expect, it, vi } from "vitest";
import { getPaymentConfig } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getPaymentConfig (the legal/compliance gate — must default off)", () => {
  it("defaults paymentsEnabled to false when PAYMENTS_ENABLED is unset", () => {
    vi.stubEnv("PAYMENTS_ENABLED", undefined as unknown as string);
    vi.stubEnv("PAYMENT_PROVIDER", undefined as unknown as string);
    expect(getPaymentConfig().paymentsEnabled).toBe(false);
  });

  it("defaults provider to \"none\" when PAYMENT_PROVIDER is unset", () => {
    vi.stubEnv("PAYMENT_PROVIDER", undefined as unknown as string);
    expect(getPaymentConfig().provider).toBe("none");
  });

  it("only treats the exact string \"true\" as enabled — never truthy-but-wrong values", () => {
    for (const value of ["1", "TRUE", "yes", "false", ""]) {
      vi.stubEnv("PAYMENTS_ENABLED", value);
      expect(getPaymentConfig().paymentsEnabled).toBe(false);
    }
    vi.stubEnv("PAYMENTS_ENABLED", "true");
    expect(getPaymentConfig().paymentsEnabled).toBe(true);
  });

  it("falls back to \"none\" for any unrecognized provider name rather than passing it through", () => {
    vi.stubEnv("PAYMENT_PROVIDER", "stripe");
    expect(getPaymentConfig().provider).toBe("none");
  });

  it("accepts \"dev\" as a provider name", () => {
    vi.stubEnv("PAYMENT_PROVIDER", "dev");
    expect(getPaymentConfig().provider).toBe("dev");
  });
});
