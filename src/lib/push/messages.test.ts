import { describe, expect, it } from "vitest";
import { buildPushContent, type PushMomentInput } from "./messages";

const base: PushMomentInput = {
  type: "perfect",
  message: "",
  correctSelections: 0,
  incorrectSelections: 0,
  totalSelections: 8,
  competitionId: 42,
};

describe("buildPushContent", () => {
  it("ENTRY_MARKET_OPEN matches the exact product-spec copy and routes to round-entry", () => {
    const content = buildPushContent({ ...base, type: "entry_market_open" });
    expect(content.title).toBe("ENTRIES ARE OPEN");
    expect(content.body).toBe("Team lists are confirmed. Pick your players and go PERFECT.");
    expect(content.data.screen).toBe("round-entry");
  });

  it("TEAM_LISTS_AVAILABLE extracts the body from the stored message", () => {
    const content = buildPushContent({ ...base, type: "team_lists_available", message: "TEAM LISTS ARE IN — NRL Round 5 lineups are confirmed. Get ready to pick." });
    expect(content.title).toBe("TEAM LISTS ARE IN");
    expect(content.body).toBe("NRL Round 5 lineups are confirmed. Get ready to pick.");
  });

  it("10 and 5 minute closing reminders are distinguished from the same type via message content", () => {
    const ten = buildPushContent({ ...base, type: "entry_closing_soon", message: "10 MINUTES TO GO — Entries close soon. Lock in your picks." });
    expect(ten.title).toBe("10 MINUTES TO GO");
    expect(ten.body).toBe("Entries close soon. Lock in your picks.");

    const five = buildPushContent({ ...base, type: "entry_closing_soon", message: "5 MINUTES TO GO — 5 minutes left to go PERFECT." });
    expect(five.title).toBe("5 MINUTES TO GO");
    expect(five.body).toBe("5 minutes left to go PERFECT.");
  });

  it("1 minute reminder matches the exact product-spec copy", () => {
    const content = buildPushContent({ ...base, type: "entry_closing_now" });
    expect(content.title).toBe("1 MINUTE TO GO");
    expect(content.body).toBe("Entries close in 1 minute. Finalise your picks now.");
  });

  it("pick milestone at 3 correct says ANOTHER PERFECT PICK with the real remaining count", () => {
    const content = buildPushContent({ ...base, type: "pick_correct_milestone", correctSelections: 3, totalSelections: 8 });
    expect(content.title).toBe("ANOTHER PERFECT PICK");
    expect(content.body).toBe("5 to go.");
  });

  it("pick milestone at 5 correct says STILL PERFECT", () => {
    const content = buildPushContent({ ...base, type: "pick_correct_milestone", correctSelections: 5, totalSelections: 8 });
    expect(content.title).toBe("STILL PERFECT");
    expect(content.body).toBe("3 to go.");
  });

  it("ONE_LEFT recovers the sport's unit word (PICK vs GAME) from the stored message", () => {
    const pick = buildPushContent({ ...base, type: "one_left", correctSelections: 7, totalSelections: 8, message: "7/8 PERFECT — ONE PICK LEFT" });
    expect(pick.title).toBe("ONE PICK LEFT");
    expect(pick.body).toBe("7/8 PERFECT. One selection stands between you and PERFECT.");

    const game = buildPushContent({ ...base, type: "one_left", correctSelections: 7, totalSelections: 8, message: "7/8 PERFECT — ONE GAME LEFT" });
    expect(game.title).toBe("ONE GAME LEFT");
  });

  it("YOU WENT PERFECT matches the exact product-spec copy", () => {
    const content = buildPushContent({ ...base, type: "perfect" });
    expect(content.title).toBe("YOU WENT PERFECT");
    expect(content.body).toBe("All your selections are correct.");
  });

  it("PERFECT ENDS HERE reports the real correct/total split", () => {
    const content = buildPushContent({ ...base, type: "perfect_ended", correctSelections: 7, totalSelections: 8 });
    expect(content.title).toBe("PERFECT ENDS HERE");
    expect(content.body).toBe("7/8 selections correct.");
  });

  it("PRIZE_WON extracts share count and amount from the stored message", () => {
    const content = buildPushContent({ ...base, type: "prize_won", message: "YOU WON — 10 SHARES OF THE PRIZE POOL — $19,500" });
    expect(content.title).toBe("YOU WON");
    expect(content.body).toBe("10 PERFECT shares. $19,500 won.");
    expect(content.data.screen).toBe("my-entries");
  });

  it("ROLLOVER and ROLLOVER_JACKPOT have distinct titles but consistent messaging, and route to results", () => {
    const rollover = buildPushContent({ ...base, type: "rollover" });
    expect(rollover.title).toBe("ROLLOVER");
    const jackpot = buildPushContent({ ...base, type: "rollover_jackpot" });
    expect(jackpot.title).toBe("ROLLOVER JACKPOT");
    expect(rollover.data.screen).toBe("results");
    expect(jackpot.data.screen).toBe("results");
  });

  it("every moment's data payload always carries its own competitionId", () => {
    const content = buildPushContent({ ...base, type: "perfect", competitionId: 999 });
    expect(content.data.competitionId).toBe(999);
  });
});
