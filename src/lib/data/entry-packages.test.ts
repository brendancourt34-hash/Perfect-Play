import { describe, expect, it } from "vitest";
import { splitPackagePriceAcrossEntries } from "./entry-packages";

describe("splitPackagePriceAcrossEntries — one package debit, split across N identical entries for bookkeeping", () => {
  it("a 1-entry package attributes the whole price to that one entry", () => {
    expect(splitPackagePriceAcrossEntries(500, 1)).toEqual([500]);
  });

  it("a 5-entry $20 package splits evenly: $4.00 per entry, summing back to exactly $20", () => {
    const shares = splitPackagePriceAcrossEntries(2000, 5);
    expect(shares).toEqual([400, 400, 400, 400, 400]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(2000);
  });

  it("a 10-entry $35 package splits without losing a cent, even though 3500/10 isn't perfectly even in principle here it is: $3.50 each", () => {
    const shares = splitPackagePriceAcrossEntries(3500, 10);
    expect(shares).toEqual(Array(10).fill(350));
    expect(shares.reduce((a, b) => a + b, 0)).toBe(3500);
  });

  it("a genuinely uneven split (e.g. $10.01 across 3 entries) still sums to the exact total, never losing or inventing a cent", () => {
    const shares = splitPackagePriceAcrossEntries(1001, 3);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1001);
    expect(shares.sort()).toEqual([333, 334, 334]);
  });
});
