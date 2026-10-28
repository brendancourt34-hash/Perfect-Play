import { describe, expect, it } from "vitest";
import { nextWeekStart, sydneyDateString, sydneyWeekdayName, weekStartForInstant } from "./week-window";

const ROUND_DAYS = ["thursday", "friday", "saturday", "sunday"] as const;

describe("sydneyDateString / sydneyWeekdayName", () => {
  it("converts a UTC instant to its Sydney-local calendar date and weekday name", () => {
    // 2026-10-16T23:00:00Z is 2026-10-17 09:00 AEDT (Sydney is UTC+11 in October) — a Saturday.
    const instant = new Date("2026-10-16T23:00:00Z");
    expect(sydneyDateString(instant)).toBe("2026-10-17");
    expect(sydneyWeekdayName(instant)).toBe("saturday");
  });

  it("a US-timezone kickoff timestamp is grouped by the Sydney date, not the US date", () => {
    // 2026-10-24T23:30:00Z is still 2026-10-24 in New York (7:30pm EDT) but already
    // 2026-10-25 (Sunday) in Sydney (10:30am AEDT) — this is exactly the NBA ESPN-provider
    // scenario the fix targets: the customer must see the Sydney day, not the US one.
    const instant = new Date("2026-10-24T23:30:00Z");
    expect(sydneyDateString(instant)).toBe("2026-10-25");
    expect(sydneyWeekdayName(instant)).toBe("sunday");
  });
});

describe("weekStartForInstant", () => {
  // Explicit Sydney-local midday-ish instants (UTC+11 in October, no DST ambiguity) for
  // each day for one real Thursday-Sunday week.
  const thu = new Date("2026-10-15T01:00:00Z"); // 2026-10-15 Sydney, Thursday
  const fri = new Date("2026-10-16T01:00:00Z"); // Friday
  const sat = new Date("2026-10-17T01:00:00Z"); // Saturday
  const sun = new Date("2026-10-18T01:00:00Z"); // Sunday

  it("a Thursday game's week start is its own Sydney date", () => {
    expect(sydneyWeekdayName(thu)).toBe("thursday");
    expect(weekStartForInstant(thu, ROUND_DAYS)).toBe(sydneyDateString(thu));
  });

  it("every day in the same real Thursday-Sunday week resolves to the SAME week-start date", () => {
    expect(sydneyWeekdayName(fri)).toBe("friday");
    expect(sydneyWeekdayName(sat)).toBe("saturday");
    expect(sydneyWeekdayName(sun)).toBe("sunday");

    const weekOf = weekStartForInstant(thu, ROUND_DAYS);
    expect(weekStartForInstant(fri, ROUND_DAYS)).toBe(weekOf);
    expect(weekStartForInstant(sat, ROUND_DAYS)).toBe(weekOf);
    expect(weekStartForInstant(sun, ROUND_DAYS)).toBe(weekOf);
    expect(weekOf).toBe("2026-10-15");
  });

  it("the following week's Thursday resolves to a DIFFERENT week-start date, one week later", () => {
    const thisThursday = new Date("2026-10-15T01:00:00Z");
    const nextThursday = new Date("2026-10-22T01:00:00Z");
    const weekA = weekStartForInstant(thisThursday, ROUND_DAYS);
    const weekB = weekStartForInstant(nextThursday, ROUND_DAYS);
    expect(weekA).not.toBe(weekB);
    expect(weekB).toBe(nextWeekStart(weekA));
  });

  it("games from two different months never collapse into the same week (the exact bug this replaces)", () => {
    const octoberThursday = new Date("2026-10-15T01:00:00Z");
    const marchThursday = new Date("2027-03-11T00:00:00Z"); // a Thursday roughly 5 months later
    expect(sydneyWeekdayName(marchThursday)).toBe("thursday");
    expect(weekStartForInstant(octoberThursday, ROUND_DAYS)).not.toBe(weekStartForInstant(marchThursday, ROUND_DAYS));
  });
});

describe("nextWeekStart", () => {
  it("adds exactly 7 calendar days", () => {
    expect(nextWeekStart("2026-10-15")).toBe("2026-10-22");
  });

  it("rolls over a month/year boundary correctly", () => {
    expect(nextWeekStart("2026-12-31")).toBe("2027-01-07");
  });
});
