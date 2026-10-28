/**
 * Deterministic seeded game selection — the pure core of the NBA/NFL automated
 * 8-game randomiser. No I/O, no Date.now(), no Math.random(): given the same seed and
 * the same eligible-game input, this always produces exactly the same output, which is
 * what makes the selection reproducible/auditable. The seed ITSELF must come from a
 * cryptographically strong source (crypto.randomBytes — see auto-round-selection.ts,
 * which is the only caller allowed to mint one); this module never generates its own
 * randomness, it only consumes a seed already generated elsewhere.
 *
 * Algorithm: hash the hex seed down to a 32-bit int, feed it into mulberry32 (a small,
 * well-known, widely-used seeded PRNG — see https://gist.github.com/tommyettinger, the
 * common public-domain reference implementation), and drive a standard Fisher-Yates
 * shuffle with it. Both pieces are intentionally simple, well-understood building blocks
 * rather than a custom cryptographic scheme — this only needs to be an unbiased,
 * deterministic shuffle, not cryptographically secure by itself (the security property
 * this system actually needs — a client can't predict or choose the outcome — comes from
 * the seed being minted server-side from crypto.randomBytes, never from this shuffle
 * being hard to reverse).
 */

/** cyrb53-style string hash — deterministic, good avalanche, plenty for seeding a PRNG (not for anything cryptographic). */
function hashSeedToUint32(seed: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return h1 >>> 0;
}

/** mulberry32 — returns a function that yields deterministic floats in [0, 1). */
function mulberry32(seedInt: number): () => number {
  let a = seedInt;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic seeded RNG factory, generalized beyond this module's own shuffle use —
 * reused by src/lib/perfect2/simulation.ts (the Perfect Rate simulation tool) so both
 * "pick 8 real games" and "simulate a customer's picks" share exactly one seeded-PRNG
 * implementation rather than two subtly-different ones. Same seed always yields the same
 * infinite sequence of floats in [0, 1).
 */
export function createSeededRng(seed: string): () => number {
  return mulberry32(hashSeedToUint32(seed));
}

/**
 * Deterministic Fisher-Yates shuffle of `ids`, seeded by `seed`. Same seed + same input
 * array (same values, same order) always yields the same output order. Pure — never
 * mutates the input array.
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const rng = createSeededRng(seed);
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export interface SelectableGame {
  gameId: number;
  /** Lowercase day name (e.g. "thursday") in the sport's display timezone — only used for day-bucketed sports like NBA. Null if the sport has no day-shape. */
  dayLabel: string | null;
}

export interface GameSelectionAssignment {
  gameId: number;
  slotLabel: string | null;
}

export type SelectGamesResult =
  | { status: "ok"; selectedGameIds: number[]; assignments: GameSelectionAssignment[] }
  | { status: "insufficient"; eligibleCount: number; required: number; details?: string[] };

/**
 * Selects exactly `required` games from `eligible`, deterministically shuffled by `seed`.
 *
 * Two modes, chosen by whether `gamesPerDay`/`roundDays` are provided (NBA's fixed shape)
 * or not (NFL — and, if ever reused, NRL/AFL's unconstrained shape, though neither uses
 * this module in practice):
 *
 * - Day-bucketed (NBA): every game must already carry a `dayLabel` matching one of
 *   `roundDays`. `gamesPerDay` is a PREFERENCE (2/2/2/2), not a hard per-day floor — the
 *   real NBA schedule (NBA Cup weeks etc.) routinely produces uneven day counts within an
 *   otherwise perfectly valid 8-game week, and rejecting such a week would silently skip
 *   real, playable weeks. Each day is shuffled independently and takes up to its
 *   preferred count first (keeps every game in its own day equally likely to be picked,
 *   still 100% seed-determined); any shortfall is then backfilled — via one more seeded
 *   shuffle — from whatever's left over on the OTHER days in the SAME window. The only
 *   hard requirement is a total of `required` real games somewhere in the window; it
 *   never reaches into a different week to make up the count.
 * - Flat (NFL, or any sport with no day shape): the whole eligible pool is shuffled once
 *   and the first `required` are taken.
 *
 * Never returns fewer than `required` selected games — if the eligible pool (whole pool
 * in flat mode; the whole window, summed across days, in day-bucketed mode) doesn't have
 * enough real games, the whole selection fails with status "insufficient" rather than
 * silently returning a short list or borrowing from elsewhere.
 */
export function selectGamesForShape(
  eligible: readonly SelectableGame[],
  seed: string,
  required: number,
  dayShape: { gamesPerDay: number; roundDays: readonly string[] } | null,
): SelectGamesResult {
  if (!dayShape) {
    if (eligible.length < required) {
      return { status: "insufficient", eligibleCount: eligible.length, required };
    }
    const shuffled = seededShuffle(
      eligible.map((g) => g.gameId),
      seed,
    );
    const selectedGameIds = shuffled.slice(0, required);
    return { status: "ok", selectedGameIds, assignments: selectedGameIds.map((gameId) => ({ gameId, slotLabel: null })) };
  }

  const { gamesPerDay, roundDays } = dayShape;
  const byDay = new Map<string, number[]>();
  for (const day of roundDays) byDay.set(day, []);
  for (const g of eligible) {
    if (g.dayLabel && byDay.has(g.dayLabel)) byDay.get(g.dayLabel)!.push(g.gameId);
  }
  const eligibleThisWindow = [...byDay.values()].reduce((sum, ids) => sum + ids.length, 0);

  // The ONLY hard requirement is a total of `required` real games somewhere in this one
  // window (roundDays are assumed to already all belong to the same real calendar week —
  // the caller, generateRoundGameSelection, is what enforces that by only ever passing in
  // one week's eligible games at a time). `gamesPerDay` is a PREFERENCE, not a floor: the
  // real NBA schedule (NBA Cup, etc.) routinely skews unevenly across a Thu-Sun window,
  // and rejecting an otherwise-valid 8-game week over a 1/3/2/2 split would silently skip
  // real, playable weeks — exactly the bug this replaces.
  if (eligibleThisWindow < required) {
    return {
      status: "insufficient",
      eligibleCount: eligibleThisWindow,
      required,
      details: roundDays.map((day) => `${day}: ${byDay.get(day)?.length ?? 0} eligible`),
    };
  }

  const assignments: GameSelectionAssignment[] = [];
  const selectedGameIds: number[] = [];
  const leftover: { gameId: number; slotLabel: string }[] = [];
  for (const day of roundDays) {
    // Seed each day's sub-shuffle deterministically off the shared seed + day name, so the
    // whole selection is still driven by exactly one stored seed, but one day's shuffle
    // never influences another's.
    const daySeed = `${seed}:${day}`;
    const shuffled = seededShuffle(byDay.get(day)!, daySeed);
    const takeCount = Math.min(gamesPerDay, shuffled.length);
    for (const gameId of shuffled.slice(0, takeCount)) {
      assignments.push({ gameId, slotLabel: day });
      selectedGameIds.push(gameId);
    }
    // Whatever's left on this (abundant) day after taking the preferred amount becomes
    // available as backfill for a DIFFERENT day that came up short — still the same
    // window, still fully seeded/deterministic, never borrowed from another week.
    for (const gameId of shuffled.slice(takeCount)) leftover.push({ gameId, slotLabel: day });
  }

  const stillNeeded = required - selectedGameIds.length;
  if (stillNeeded > 0) {
    // total eligible >= required was already checked above, so the leftover pool is
    // guaranteed to have at least `stillNeeded` games — this can never under-fill.
    const backfillSeed = `${seed}:backfill`;
    const shuffledLeftover = seededShuffle(leftover, backfillSeed);
    for (const { gameId, slotLabel } of shuffledLeftover.slice(0, stillNeeded)) {
      assignments.push({ gameId, slotLabel });
      selectedGameIds.push(gameId);
    }
  }

  return { status: "ok", selectedGameIds, assignments };
}
