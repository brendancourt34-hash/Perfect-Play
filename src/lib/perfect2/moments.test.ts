import { describe, expect, it } from "vitest";
import { computeMoment, isTerminalMomentType, momentDedupeKey } from "./moments";

describe("computeMoment — Perfect Play Moments progression engine", () => {
  it("returns null with zero correct/incorrect and games still to go (no premature moment)", () => {
    expect(computeMoment({ totalSelections: 8, correctSelections: 0, incorrectSelections: 0 }, "PICK")).toBeNull();
    expect(computeMoment({ totalSelections: 8, correctSelections: 1, incorrectSelections: 0 }, "PICK")).toBeNull();
  });

  it("fires the first milestone at 3 correct — 'ANOTHER PERFECT PICK'", () => {
    const moment = computeMoment({ totalSelections: 8, correctSelections: 3, incorrectSelections: 0 }, "PICK");
    expect(moment).toEqual({ type: "pick_correct_milestone", message: "ANOTHER PERFECT PICK — 5 TO GO" });
  });

  it("fires the second milestone at 5 correct — 'STILL PERFECT'", () => {
    const moment = computeMoment({ totalSelections: 8, correctSelections: 5, incorrectSelections: 0 }, "PICK");
    expect(moment).toEqual({ type: "pick_correct_milestone", message: "STILL PERFECT — 3 TO GO" });
  });

  it("does not re-fire a milestone at a non-threshold correct count (e.g. 4)", () => {
    expect(computeMoment({ totalSelections: 8, correctSelections: 4, incorrectSelections: 0 }, "PICK")).toBeNull();
  });

  it("fires ONE_LEFT with the sport's noun when exactly one selection remains (NRL/AFL use PICK)", () => {
    const moment = computeMoment({ totalSelections: 8, correctSelections: 7, incorrectSelections: 0 }, "PICK");
    expect(moment).toEqual({ type: "one_left", message: "7/8 PERFECT — ONE PICK LEFT" });
  });

  it("AFL's 9-game round: ONE_LEFT reads 8/9", () => {
    const moment = computeMoment({ totalSelections: 9, correctSelections: 8, incorrectSelections: 0 }, "PICK");
    expect(moment).toEqual({ type: "one_left", message: "8/9 PERFECT — ONE PICK LEFT" });
  });

  it("NBA/NFL use GAME instead of PICK for the one-remaining moment", () => {
    const moment = computeMoment({ totalSelections: 8, correctSelections: 7, incorrectSelections: 0 }, "GAME");
    expect(moment).toEqual({ type: "one_left", message: "7/8 PERFECT — ONE GAME LEFT" });
  });

  it("fires PERFECT once every selection is correct", () => {
    const moment = computeMoment({ totalSelections: 8, correctSelections: 8, incorrectSelections: 0 }, "PICK");
    expect(moment).toEqual({ type: "perfect", message: "YOU WENT PERFECT — ALL PICKS CORRECT" });
  });

  it("fires PERFECT_ENDED as soon as there is any incorrect selection, regardless of how many are still pending", () => {
    const moment = computeMoment({ totalSelections: 8, correctSelections: 2, incorrectSelections: 1 }, "PICK");
    expect(moment).toEqual({ type: "perfect_ended", message: "PERFECT ENDS HERE — 2/8" });
  });

  it("PERFECT_ENDED takes precedence over a milestone/one-left that would otherwise also match", () => {
    // 7 correct + 1 incorrect = 8 total, remaining 0 — a naive check might also think
    // "one left"/milestone, but even one incorrect selection ends the run outright.
    const moment = computeMoment({ totalSelections: 8, correctSelections: 7, incorrectSelections: 1 }, "PICK");
    expect(moment?.type).toBe("perfect_ended");
  });

  it("is a pure function of its inputs — same progress always yields the same candidate", () => {
    const progress = { totalSelections: 8, correctSelections: 3, incorrectSelections: 0 };
    expect(computeMoment(progress, "PICK")).toEqual(computeMoment(progress, "PICK"));
  });
});

describe("isTerminalMomentType", () => {
  it("PERFECT and PERFECT_ENDED are terminal; everything else is not", () => {
    expect(isTerminalMomentType("perfect")).toBe(true);
    expect(isTerminalMomentType("perfect_ended")).toBe(true);
    expect(isTerminalMomentType("one_left")).toBe(false);
    expect(isTerminalMomentType("pick_correct_milestone")).toBe(false);
  });
});

describe("momentDedupeKey", () => {
  it("is stable for the same (user, competition, candidate) — a retried settlement never double-fires", () => {
    const candidate = { type: "perfect" as const, message: "YOU WENT PERFECT — ALL PICKS CORRECT" };
    expect(momentDedupeKey(1, 10, candidate)).toBe(momentDedupeKey(1, 10, candidate));
  });

  it("distinguishes the two milestone thresholds for the same user/competition", () => {
    const at3 = { type: "pick_correct_milestone" as const, message: "ANOTHER PERFECT PICK — 5 TO GO" };
    const at5 = { type: "pick_correct_milestone" as const, message: "STILL PERFECT — 3 TO GO" };
    expect(momentDedupeKey(1, 10, at3)).not.toBe(momentDedupeKey(1, 10, at5));
  });

  it("distinguishes different users and different competitions", () => {
    const candidate = { type: "one_left" as const, message: "7/8 PERFECT — ONE PICK LEFT" };
    expect(momentDedupeKey(1, 10, candidate)).not.toBe(momentDedupeKey(2, 10, candidate));
    expect(momentDedupeKey(1, 10, candidate)).not.toBe(momentDedupeKey(1, 11, candidate));
  });
});
