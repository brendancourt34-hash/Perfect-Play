import { describe, expect, it } from "vitest";
import {
  canAcceptEntries,
  computeFirstGameKickoff,
  decideCloseAction,
  decideSettleAction,
  getEffectiveCompetitionState,
  hasFirstGameKickedOff,
} from "./lifecycle";

const now = new Date("2026-09-04T12:00:00Z");
const past = new Date("2026-09-04T10:00:00Z");
const future = new Date("2026-09-04T14:00:00Z");

describe("getEffectiveCompetitionState", () => {
  it("an open competition with no timing set is simply open", () => {
    expect(getEffectiveCompetitionState({ status: "open", opensAt: null, closesAt: null }, now)).toBe("open");
  });

  it("before opensAt, an open-status competition is not_yet_open", () => {
    expect(getEffectiveCompetitionState({ status: "open", opensAt: future, closesAt: null }, now)).toBe("not_yet_open");
  });

  it("between opensAt and closesAt, it's open", () => {
    expect(getEffectiveCompetitionState({ status: "open", opensAt: past, closesAt: future }, now)).toBe("open");
  });

  it("at or after closesAt, an open-status competition is effectively closed", () => {
    expect(getEffectiveCompetitionState({ status: "open", opensAt: past, closesAt: past }, now)).toBe("closed");
    expect(getEffectiveCompetitionState({ status: "open", opensAt: past, closesAt: now }, now)).toBe("closed");
  });

  it("explicit closed status always wins, even if closesAt is in the future", () => {
    expect(getEffectiveCompetitionState({ status: "closed", opensAt: past, closesAt: future }, now)).toBe("closed");
  });

  it("explicit settled status always wins over any timing", () => {
    expect(getEffectiveCompetitionState({ status: "settled", opensAt: past, closesAt: future }, now)).toBe("settled");
    expect(getEffectiveCompetitionState({ status: "settled", opensAt: future, closesAt: null }, now)).toBe("settled");
  });
});

describe("canAcceptEntries", () => {
  it("true only in the open state", () => {
    expect(canAcceptEntries({ status: "open", opensAt: null, closesAt: null }, now)).toBe(true);
  });

  it("false before opensAt", () => {
    expect(canAcceptEntries({ status: "open", opensAt: future, closesAt: null }, now)).toBe(false);
  });

  it("false after closesAt", () => {
    expect(canAcceptEntries({ status: "open", opensAt: past, closesAt: past }, now)).toBe(false);
  });

  it("false when explicitly closed or settled regardless of timing", () => {
    expect(canAcceptEntries({ status: "closed", opensAt: past, closesAt: future }, now)).toBe(false);
    expect(canAcceptEntries({ status: "settled", opensAt: past, closesAt: future }, now)).toBe(false);
  });
});

describe("decideCloseAction", () => {
  it("closes an open competition", () => {
    expect(decideCloseAction("open")).toBe("close");
  });

  it("closeCompetition is safe to call twice — already-closed is a no-op", () => {
    expect(decideCloseAction("closed")).toBe("noop");
  });

  it("never re-opens or otherwise changes an already-settled competition", () => {
    expect(decideCloseAction("settled")).toBe("noop");
  });
});

describe("decideSettleAction", () => {
  it("refuses to settle a competition that's still open", () => {
    expect(decideSettleAction("open", true)).toBe("not_ready");
    expect(decideSettleAction("open", false)).toBe("not_ready");
  });

  it("does not settle a closed competition while games remain unfinished", () => {
    expect(decideSettleAction("closed", false)).toBe("not_ready");
  });

  it("settles a closed competition once every game is final", () => {
    expect(decideSettleAction("closed", true)).toBe("settle");
  });

  it("settleCompetition is safe to call twice — already-settled is a no-op", () => {
    expect(decideSettleAction("settled", true)).toBe("noop");
    expect(decideSettleAction("settled", false)).toBe("noop");
  });
});

describe("computeFirstGameKickoff", () => {
  it("returns null for an empty round", () => {
    expect(computeFirstGameKickoff([])).toBeNull();
  });

  it("returns null when no game has a known kickoff yet", () => {
    expect(computeFirstGameKickoff([{ kickoff: null }, { kickoff: null }])).toBeNull();
  });

  it("returns the earliest kickoff regardless of array order", () => {
    const early = new Date("2026-09-04T09:00:00Z");
    const mid = new Date("2026-09-04T11:00:00Z");
    const late = new Date("2026-09-04T13:00:00Z");
    // Deliberately out of order — must not rely on array position.
    expect(computeFirstGameKickoff([{ kickoff: late }, { kickoff: early }, { kickoff: mid }])).toBe(early);
  });

  it("ignores games with no kickoff yet rather than treating null as earliest", () => {
    const known = new Date("2026-09-04T09:00:00Z");
    expect(computeFirstGameKickoff([{ kickoff: null }, { kickoff: known }])).toBe(known);
  });

  it("two games at the identical instant resolve deterministically to that instant", () => {
    const tie = new Date("2026-09-04T09:00:00Z");
    const later = new Date("2026-09-04T11:00:00Z");
    expect(computeFirstGameKickoff([{ kickoff: tie }, { kickoff: tie }, { kickoff: later }])?.getTime()).toBe(tie.getTime());
  });
});

describe("hasFirstGameKickedOff", () => {
  it("false when there is no known first kickoff yet", () => {
    expect(hasFirstGameKickedOff(null, now)).toBe(false);
  });

  it("false strictly before kickoff", () => {
    expect(hasFirstGameKickedOff(future, now)).toBe(false);
  });

  it("true exactly at kickoff — the boundary instant counts as kicked off", () => {
    expect(hasFirstGameKickedOff(now, now)).toBe(true);
  });

  it("true after kickoff", () => {
    expect(hasFirstGameKickedOff(past, now)).toBe(true);
  });
});
