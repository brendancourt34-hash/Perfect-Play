import { describe, expect, it } from "vitest";
import { mapInjuryStatus } from "./nba-espn-provider";

describe("mapInjuryStatus — never invents a status ESPN didn't actually report", () => {
  it("maps every real observed/known ESPN injury string to its canonical value", () => {
    expect(mapInjuryStatus("Out")).toBe("OUT");
    expect(mapInjuryStatus("Doubtful")).toBe("DOUBTFUL");
    expect(mapInjuryStatus("Questionable")).toBe("QUESTIONABLE");
    expect(mapInjuryStatus("Day-To-Day")).toBe("DAY_TO_DAY");
    expect(mapInjuryStatus("Probable")).toBe("PROBABLE");
  });

  it("is case-insensitive (ESPN's real casing has been observed to vary)", () => {
    expect(mapInjuryStatus("OUT")).toBe("OUT");
    expect(mapInjuryStatus("out")).toBe("OUT");
    expect(mapInjuryStatus("day-to-day")).toBe("DAY_TO_DAY");
  });

  it("returns null for undefined (no injuries[] entry at all) — never fabricates a designation", () => {
    expect(mapInjuryStatus(undefined)).toBeNull();
  });

  it("returns null for an unrecognized string rather than guessing or throwing", () => {
    expect(mapInjuryStatus("Some New Status ESPN Invents Later")).toBeNull();
  });

  it("tolerates incidental whitespace from the provider", () => {
    expect(mapInjuryStatus("  Out  ")).toBe("OUT");
  });
});
