import { describe, expect, it } from "vitest";
import { formatAudCents, formatAuDate, formatAuDateTime, formatStatLabel } from "./format";

describe("formatAudCents", () => {
  it("formats a whole-dollar amount without decimals", () => {
    expect(formatAudCents(500)).toBe("$5");
  });

  it("formats a fractional amount with decimals", () => {
    expect(formatAudCents(550)).toBe("$5.50");
  });

  it("formats the default prize amount", () => {
    expect(formatAudCents(6000)).toBe("$60");
  });
});

describe("formatStatLabel", () => {
  it("singularizes 1 try / 1 goal", () => {
    expect(formatStatLabel("tries", 1)).toBe("1 try");
    expect(formatStatLabel("goals", 1)).toBe("1 goal");
  });

  it("pluralizes 0 and 2+", () => {
    expect(formatStatLabel("tries", 0)).toBe("0 tries");
    expect(formatStatLabel("tries", 2)).toBe("2 tries");
    expect(formatStatLabel("goals", 0)).toBe("0 goals");
    expect(formatStatLabel("goals", 3)).toBe("3 goals");
  });

  it("shows Pending rather than a fabricated 0 when the stat isn't known yet", () => {
    expect(formatStatLabel("tries", null)).toBe("Pending");
  });
});

describe("formatAuDate / formatAuDateTime", () => {
  it("returns a placeholder for a missing value rather than throwing", () => {
    expect(formatAuDate(null)).toBe("TBC");
    expect(formatAuDateTime(null)).toBe("Kickoff TBC");
  });

  it("returns a placeholder for an invalid date string", () => {
    expect(formatAuDate("not-a-date")).toBe("TBC");
  });

  it("formats a real ISO date in Australian style", () => {
    expect(formatAuDate("2026-03-01T09:00:00Z")).toMatch(/2026/);
  });
});
