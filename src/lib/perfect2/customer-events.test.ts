import { describe, expect, it } from "vitest";
import {
  determineClosingReminderBuckets,
  entryClosingReminderEvent,
  entryMarketOpenEvent,
  prizeWonEvent,
  rolloverEvent,
  teamListsAvailableEvent,
} from "./customer-events";

describe("entryMarketOpenEvent", () => {
  it("has the exact product-spec copy", () => {
    expect(entryMarketOpenEvent().message).toBe("ENTRIES ARE OPEN — Team lists are confirmed. Pick your players and go PERFECT.");
    expect(entryMarketOpenEvent().type).toBe("entry_market_open");
  });
});

describe("teamListsAvailableEvent", () => {
  it("includes the sport and round in the message", () => {
    const event = teamListsAvailableEvent("NRL", "Round 5");
    expect(event.message).toContain("NRL");
    expect(event.message).toContain("Round 5");
    expect(event.type).toBe("team_lists_available");
  });
});

describe("determineClosingReminderBuckets", () => {
  it("returns no buckets well before the 10-minute window", () => {
    expect(determineClosingReminderBuckets(45)).toEqual([]);
  });

  it("returns only the 10-minute bucket between 10 and 5 minutes remaining", () => {
    expect(determineClosingReminderBuckets(10)).toEqual(["10"]);
    expect(determineClosingReminderBuckets(7)).toEqual(["10"]);
  });

  it("returns 10 and 5 minute buckets together between 5 and 1 minutes remaining", () => {
    expect(determineClosingReminderBuckets(5)).toEqual(["10", "5"]);
    expect(determineClosingReminderBuckets(3)).toEqual(["10", "5"]);
  });

  it("returns all three buckets inside the final minute", () => {
    expect(determineClosingReminderBuckets(1)).toEqual(["10", "5", "1"]);
    expect(determineClosingReminderBuckets(0.5)).toEqual(["10", "5", "1"]);
  });

  it("returns no buckets once the cutoff has passed", () => {
    expect(determineClosingReminderBuckets(-0.01)).toEqual([]);
  });
});

describe("entryClosingReminderEvent", () => {
  it("produces the exact product-spec copy for each bucket", () => {
    expect(entryClosingReminderEvent("10").message).toBe("10 MINUTES TO GO — Entries close soon. Lock in your picks.");
    expect(entryClosingReminderEvent("5").message).toBe("5 MINUTES TO GO — 5 minutes left to go PERFECT.");
    expect(entryClosingReminderEvent("1").message).toBe("1 MINUTE TO GO — Entries close in 1 minute. Finalise your picks now.");
  });

  it("the 10 and 5 minute reminders share the entry_closing_soon type but have distinct dedupe suffixes", () => {
    expect(entryClosingReminderEvent("10").type).toBe("entry_closing_soon");
    expect(entryClosingReminderEvent("5").type).toBe("entry_closing_soon");
    expect(entryClosingReminderEvent("10").dedupeSuffix).not.toBe(entryClosingReminderEvent("5").dedupeSuffix);
  });

  it("the 1-minute reminder is its own entry_closing_now type", () => {
    expect(entryClosingReminderEvent("1").type).toBe("entry_closing_now");
  });
});

describe("rolloverEvent", () => {
  it("distinguishes a first-time rollover from a growing jackpot", () => {
    expect(rolloverEvent(false).type).toBe("rollover");
    expect(rolloverEvent(true).type).toBe("rollover_jackpot");
    expect(rolloverEvent(true).message).toContain("JACKPOT");
  });
});

describe("prizeWonEvent", () => {
  it("pluralizes SHARE correctly and includes the formatted dollar amount", () => {
    expect(prizeWonEvent(1, 500_000).message).toBe("YOU WON — 1 SHARE OF THE PRIZE POOL — $5,000");
    expect(prizeWonEvent(10, 1_950_000).message).toBe("YOU WON — 10 SHARES OF THE PRIZE POOL — $19,500");
  });
});
