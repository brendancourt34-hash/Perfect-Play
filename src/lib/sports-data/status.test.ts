import { describe, expect, it } from "vitest";
import { mapExternalGameStatus } from "./status";

const mapping = { sched: "scheduled", inprogress: "live", done: "final" } as const;

describe("mapExternalGameStatus", () => {
  it("maps a recognised external status to the internal enum", () => {
    expect(mapExternalGameStatus("sched", mapping)).toBe("scheduled");
    expect(mapExternalGameStatus("inprogress", mapping)).toBe("live");
    expect(mapExternalGameStatus("done", mapping)).toBe("final");
  });

  it("fails clearly for an unrecognised status rather than guessing", () => {
    expect(() => mapExternalGameStatus("postponed", mapping)).toThrow(/Unrecognised external game status/);
  });
});
