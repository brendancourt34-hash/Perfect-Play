import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, InvalidPaymentTransitionError } from "./state-machine";

describe("canTransition", () => {
  it("allows pending -> paid", () => expect(canTransition("pending", "paid")).toBe(true));
  it("allows pending -> failed", () => expect(canTransition("pending", "failed")).toBe(true));
  it("allows pending -> cancelled", () => expect(canTransition("pending", "cancelled")).toBe(true));
  it("allows paid -> refunded", () => expect(canTransition("paid", "refunded")).toBe(true));

  it("allows every same-state transition as an idempotent no-op", () => {
    for (const s of ["pending", "paid", "failed", "cancelled", "refunded"] as const) {
      expect(canTransition(s, s)).toBe(true);
    }
  });

  it("rejects failed -> paid", () => expect(canTransition("failed", "paid")).toBe(false));
  it("rejects cancelled -> paid", () => expect(canTransition("cancelled", "paid")).toBe(false));
  it("rejects refunded -> paid", () => expect(canTransition("refunded", "paid")).toBe(false));
  it("rejects refunded -> failed", () => expect(canTransition("refunded", "failed")).toBe(false));
  it("rejects refunded -> cancelled", () => expect(canTransition("refunded", "cancelled")).toBe(false));
  it("rejects paid -> pending", () => expect(canTransition("paid", "pending")).toBe(false));
  it("rejects paid -> failed", () => expect(canTransition("paid", "failed")).toBe(false));
  it("rejects pending -> refunded (must go through paid first)", () => expect(canTransition("pending", "refunded")).toBe(false));
});

describe("assertTransition", () => {
  it("does not throw for an allowed transition", () => {
    expect(() => assertTransition("pending", "paid")).not.toThrow();
  });
  it("throws InvalidPaymentTransitionError for a disallowed transition", () => {
    expect(() => assertTransition("refunded", "paid")).toThrow(InvalidPaymentTransitionError);
  });
});
