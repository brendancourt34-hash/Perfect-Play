import { describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({}));
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));

describe("isInternalTestRound", async () => {
  const { isInternalTestRound } = await import("./api");
  it("hides rounds created by the QA scripts", () => {
    expect(isInternalTestRound({ name: "qa-moments-perfect-1789709579808" })).toBe(true);
    expect(isInternalTestRound({ name: "qa23h-roll-1789" })).toBe(true);
    expect(isInternalTestRound({ name: "QA-test-internal-phase19" })).toBe(true);
  });
  it("keeps real customer rounds", () => {
    expect(isInternalTestRound({ name: "Perfect Play NBA — Round 2" })).toBe(false);
    expect(isInternalTestRound({ name: null })).toBe(false);
    expect(isInternalTestRound({ name: "Quarter finals" })).toBe(false);
  });
});
