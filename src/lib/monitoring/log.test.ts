import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logEvent } from "./log";

describe("logEvent — structured operational logging", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("emits one JSON line to console.log at the default 'info' level", () => {
    logEvent("wallet_debit", { userId: 1, amountCents: 500 });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ event: "wallet_debit", level: "info", userId: 1, amountCents: 500 });
    expect(typeof parsed.at).toBe("string");
  });

  it("routes 'warn' to console.warn and 'error' to console.error", () => {
    logEvent("cutoff_rejected", { userId: 1 }, "warn");
    logEvent("settlement_failed", { competitionId: 1 }, "error");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("redacts any field whose key looks like a secret/credential, even if a call site passes one by mistake", () => {
    logEvent("payment_confirmed", { userId: 1, password: "hunter2", authToken: "abc", cardNumber: "4111" } as never);
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.password).toBe("[redacted]");
    expect(parsed.authToken).toBe("[redacted]");
    expect(parsed.cardNumber).toBe("[redacted]");
    expect(parsed.userId).toBe(1);
  });
});
