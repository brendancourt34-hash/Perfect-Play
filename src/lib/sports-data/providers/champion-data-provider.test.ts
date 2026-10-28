import { describe, expect, it } from "vitest";
import { ChampionDataProvider } from "./champion-data-provider";

describe("ChampionDataProvider (boundary placeholder)", () => {
  it("fails clearly on construction rather than pretending to be connected", () => {
    expect(() => new ChampionDataProvider()).toThrow(/Champion Data API access has not been granted/);
  });
});
