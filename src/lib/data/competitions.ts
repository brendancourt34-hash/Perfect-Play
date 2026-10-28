import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { decideCloseAction } from "@/lib/competitions/lifecycle";
import { safeQuery, type DataResult } from "./result";

export type Competition = typeof schema.competitions.$inferSelect;

/**
 * Returns the competition row for one sport's one round (e.g. "Perfect Play NRL — Round 5"),
 * creating it with default pricing/status if it doesn't exist yet. NRL and AFL always get
 * separate rows, and every round gets its own row — never shared across sports or rounds.
 *
 * Phase 19: a newly-created row also tries to pull any unclaimed rollover from the
 * immediately preceding same-sport, same-season competition (see tryClaimRollover below).
 * This covers the ordering where round R+1 is opened/entered *after* round R has already
 * settled with zero winners. The reverse ordering (R settles *after* R+1 already exists)
 * is covered by the equivalent push attempt inside settleCompetition
 * (src/lib/data/settlement.ts) — both use the same atomic claim guard, so whichever runs
 * first wins and the other is a safe no-op.
 */
export async function getOrCreateCompetition(
  sportId: number,
  roundId: number,
  name: string,
  closesAt?: Date | null,
): Promise<DataResult<Competition>> {
  return safeQuery(async () => {
    const db = getDb();
    const existing = await db
      .select()
      .from(schema.competitions)
      .where(and(eq(schema.competitions.sportId, sportId), eq(schema.competitions.roundId, roundId)))
      .limit(1);
    if (existing[0]) return existing[0];

    // Race-safety: two concurrent first-entrants into a brand-new round can both pass the
    // SELECT above (row doesn't exist yet) and both reach this INSERT. Without
    // onConflictDoNothing, the loser's INSERT throws a raw unique-violation on
    // competitions_sport_round_unique (sportId, roundId), which safeQuery turns into a
    // generic "unavailable" 503 for that user's real entry attempt — a genuine
    // availability bug, not just an ugly error. Same pattern as getOrCreateWallet
    // (src/lib/data/wallet.ts): insert speculatively, and on conflict, re-read and return
    // the winner's row instead of failing.
    const inserted = await db
      .insert(schema.competitions)
      .values({ sportId, roundId, name, closesAt: closesAt ?? null })
      .onConflictDoNothing({ target: [schema.competitions.sportId, schema.competitions.roundId] })
      .returning();

    if (!inserted[0]) {
      // Lost the race — the winner already created this row (and, if applicable, already
      // ran the rollover-claim logic below for it). Just return what they created.
      const winner = await db
        .select()
        .from(schema.competitions)
        .where(and(eq(schema.competitions.sportId, sportId), eq(schema.competitions.roundId, roundId)))
        .limit(1);
      if (!winner[0]) throw new Error(`Competition for sport ${sportId} round ${roundId} could not be created or found.`);
      return winner[0];
    }
    const competition = inserted[0];

    const previous = await findAdjacentSameSportCompetition(sportId, roundId, "previous");
    if (previous) {
      const claimed = await tryClaimRollover(previous.id, competition.id);
      if (claimed) return { ...competition, rolloverInCents: claimed.rolloverOutCents };
    } else {
      // No previous round in THIS season — if this is round 1 of a new season, check
      // whether the previous season ended with an unclaimed rollover (its final round
      // settled with zero winners before this season's round 1 existed). See
      // findFinalUnclaimedRolloverInPreviousSeason's doc comment for why this is safe:
      // seasons are identified by year, never by "no next round yet", so this never
      // guesses whether a season has "ended".
      const roundRows = await db.select().from(schema.rounds).where(eq(schema.rounds.id, roundId)).limit(1);
      const round = roundRows[0];
      if (round && round.roundNumber === 1) {
        const crossSeasonSource = await findFinalUnclaimedRolloverInPreviousSeason(sportId, round.seasonId);
        if (crossSeasonSource) {
          const claimed = await tryClaimRollover(crossSeasonSource.id, competition.id);
          if (claimed) return { ...competition, rolloverInCents: claimed.rolloverOutCents };
        }
      }
    }
    return competition;
  });
}

/**
 * Finds the competition for the round immediately before/after this one — same sport,
 * same season ONLY (rounds.seasonId), never crossing into a different season and never
 * assuming round numbers alone are globally meaningful. Returns null at a season boundary
 * (round 1 has no "previous", the season's last round has no "next" yet) rather than
 * guessing. Cross-season rollover (final round of a season -> round 1 of the next) is
 * handled separately by findFinalUnclaimedRolloverInPreviousSeason /
 * findFirstRoundCompetitionOfNextSeason below, which key off seasons.year (an unambiguous
 * real-world fact) rather than "no next round yet" (which can't distinguish a genuinely
 * final round from one whose next round simply hasn't been synced/created yet).
 */
export async function findAdjacentSameSportCompetition(
  sportId: number,
  roundId: number,
  direction: "previous" | "next",
): Promise<Competition | null> {
  const db = getDb();
  const roundRows = await db.select().from(schema.rounds).where(eq(schema.rounds.id, roundId)).limit(1);
  const round = roundRows[0];
  if (!round) return null;

  const targetRoundNumber = direction === "previous" ? round.roundNumber - 1 : round.roundNumber + 1;
  if (targetRoundNumber < 1) return null;

  const adjacentRoundRows = await db
    .select()
    .from(schema.rounds)
    .where(and(eq(schema.rounds.seasonId, round.seasonId), eq(schema.rounds.roundNumber, targetRoundNumber)))
    .limit(1);
  const adjacentRound = adjacentRoundRows[0];
  if (!adjacentRound) return null;

  const competitionRows = await db
    .select()
    .from(schema.competitions)
    .where(and(eq(schema.competitions.sportId, sportId), eq(schema.competitions.roundId, adjacentRound.id)))
    .limit(1);
  return competitionRows[0] ?? null;
}

/**
 * Read-only rollover lookahead for display purposes only — never claims or writes
 * anything. Used when a round's competition row doesn't exist yet (nobody has entered
 * it), so the customer-facing preview price can still honestly show pending rollover
 * from the previous same-sport round instead of just the bare default base prize. The
 * real, authoritative claim still only ever happens in getOrCreateCompetition once that
 * competition row actually gets created.
 */
export async function previewUnclaimedRolloverCents(sportId: number, roundId: number): Promise<number> {
  const previous = await findAdjacentSameSportCompetition(sportId, roundId, "previous");
  if (!previous || !previous.prizeSettledAt || previous.rolloverClaimed || previous.rolloverOutCents <= 0) return 0;
  return previous.rolloverOutCents;
}

/**
 * Moves a settled-with-zero-winners competition's rolloverOutCents into another
 * competition's rolloverInCents. Returns the source row (real, with rolloverOutCents) if
 * an eligible, not-yet-claimed source was found and its amount is now guaranteed to be in
 * the target's rolloverInCents; null if there was nothing eligible to claim.
 *
 * Deliberately writes the TARGET first, then claims the SOURCE second — the opposite of
 * the "obvious" claim-then-deliver order, and for a specific reason: the target for a
 * given source is always uniquely determined (either the one same-season adjacent round,
 * or the one specific next-season round 1 — never a choice among multiple candidates), so
 * writing rolloverInCents here is always idempotent, safe to repeat as many times as this
 * function is ever called for the same (source, target) pair. Claiming the source FIRST
 * (the original design) left a real, unrecoverable-money-loss window: if the process
 * crashed or the second write failed after the source was marked claimed, NOTHING durable
 * ever recorded which target was supposed to receive the money, so it was gone for good.
 * With this order, a crash between the two writes just means the delivery already
 * happened and the claim gets finished on a later attempt; and settlement.ts's retry path
 * re-invokes this same push on every subsequent settle call until rolloverClaimed is
 * finally true, so a transient failure heals itself instead of permanently losing the
 * amount. Neon-http has no multi-statement transactions (see wallets' doc comment in
 * schema.ts) — this ordering is what makes the two separate writes safe without one.
 *
 * The rolloverClaimed flag itself still only ever flips true once (the atomic conditional
 * UPDATE below), so calling this concurrently or from both directions (see
 * getOrCreateCompetition and settleCompetition) never double-counts which source has been
 * "used up" — it only ever affects whether THIS call is the one credited with finishing
 * the claim, never whether the money was delivered (that already happened, unconditionally,
 * above).
 */
async function tryClaimRollover(sourceCompetitionId: number, targetCompetitionId: number): Promise<Competition | null> {
  const db = getDb();
  const sourceRows = await db.select().from(schema.competitions).where(eq(schema.competitions.id, sourceCompetitionId)).limit(1);
  const source = sourceRows[0];
  if (!source || !source.prizeSettledAt || source.rolloverClaimed || source.rolloverOutCents <= 0) return null;

  await db.update(schema.competitions).set({ rolloverInCents: source.rolloverOutCents }).where(eq(schema.competitions.id, targetCompetitionId));

  // This UPDATE may affect zero rows if a concurrent caller already flipped the flag a
  // moment ago — that's fine and expected, not checked here, because the delivery above
  // is already correct and complete regardless of who "wins" this flag flip.
  await db
    .update(schema.competitions)
    .set({ rolloverClaimed: true })
    .where(and(eq(schema.competitions.id, sourceCompetitionId), eq(schema.competitions.rolloverClaimed, false)));
  return { ...source, rolloverClaimed: true };
}

/**
 * Cross-season rollover, receiving side: finds the season immediately after this one for
 * the same sport (by year + 1 — an unambiguous real-world fact, never guessed from round
 * numbers) and, if that season's round 1 already has a competition row, returns it. Null
 * if there's no next season yet, or its round 1 hasn't been created yet — in either case
 * the source rollover simply stays unclaimed until this function finds something to
 * return (called again from getOrCreateCompetition when that round 1 row is created).
 */
async function findFirstRoundCompetitionOfNextSeason(sportId: number, seasonId: number): Promise<Competition | null> {
  const db = getDb();
  const seasonRows = await db.select().from(schema.seasons).where(eq(schema.seasons.id, seasonId)).limit(1);
  const season = seasonRows[0];
  if (!season) return null;

  const nextSeasonRows = await db
    .select()
    .from(schema.seasons)
    .where(and(eq(schema.seasons.sportId, sportId), eq(schema.seasons.year, season.year + 1)))
    .limit(1);
  const nextSeason = nextSeasonRows[0];
  if (!nextSeason) return null;

  const round1Rows = await db.select().from(schema.rounds).where(and(eq(schema.rounds.seasonId, nextSeason.id), eq(schema.rounds.roundNumber, 1))).limit(1);
  const round1 = round1Rows[0];
  if (!round1) return null;

  const competitionRows = await db
    .select()
    .from(schema.competitions)
    .where(and(eq(schema.competitions.sportId, sportId), eq(schema.competitions.roundId, round1.id)))
    .limit(1);
  return competitionRows[0] ?? null;
}

/**
 * Cross-season rollover, claiming side (mirrors findFirstRoundCompetitionOfNextSeason):
 * finds the season immediately before this one for the same sport (year - 1) and returns
 * its most recently settled competition (by round number, descending) that still has an
 * unclaimed rollover — i.e. that season's real final round, whatever its round number
 * turned out to be, without ever having to guess "is this the last round" at settlement
 * time. At most one such dangling rollover should ever exist per season in practice: every
 * earlier round's rollover is already claimed by its own same-season next round.
 */
async function findFinalUnclaimedRolloverInPreviousSeason(sportId: number, seasonId: number): Promise<Competition | null> {
  const db = getDb();
  const seasonRows = await db.select().from(schema.seasons).where(eq(schema.seasons.id, seasonId)).limit(1);
  const season = seasonRows[0];
  if (!season) return null;

  const previousSeasonRows = await db
    .select()
    .from(schema.seasons)
    .where(and(eq(schema.seasons.sportId, sportId), eq(schema.seasons.year, season.year - 1)))
    .limit(1);
  const previousSeason = previousSeasonRows[0];
  if (!previousSeason) return null;

  const previousSeasonRounds = await db.select().from(schema.rounds).where(eq(schema.rounds.seasonId, previousSeason.id));
  const roundIds = previousSeasonRounds.map((r) => r.id);
  if (roundIds.length === 0) return null;
  const roundNumberByRoundId = new Map(previousSeasonRounds.map((r) => [r.id, r.roundNumber]));

  const candidates = await db
    .select()
    .from(schema.competitions)
    .where(and(eq(schema.competitions.sportId, sportId), eq(schema.competitions.rolloverClaimed, false)));
  const unclaimed = candidates
    .filter((c) => roundIds.includes(c.roundId) && c.prizeSettledAt && c.rolloverOutCents > 0)
    .sort((a, b) => (roundNumberByRoundId.get(b.roundId) ?? 0) - (roundNumberByRoundId.get(a.roundId) ?? 0));
  return unclaimed[0] ?? null;
}

/**
 * Called from settleCompetition once a competition's rollover has just been determined:
 * pushes it forward if the next same-sport/season competition already exists. If that
 * doesn't exist, and this could be the season's actual final round, tries the same-sport
 * season immediately after (round 1) instead — see findFirstRoundCompetitionOfNextSeason.
 * If neither exists yet, the rollover simply stays on this (settled, immutable) row as
 * unclaimed rolloverOutCents, pulled later by whichever round actually gets created first
 * (getOrCreateCompetition checks both directions too). Never creates a competition just to
 * receive rollover.
 */
export async function pushRolloverToNextCompetitionIfExists(settledCompetition: Competition): Promise<void> {
  if (settledCompetition.rolloverOutCents <= 0 || settledCompetition.rolloverClaimed) return;
  const next = await findAdjacentSameSportCompetition(settledCompetition.sportId, settledCompetition.roundId, "next");
  if (next) {
    await tryClaimRollover(settledCompetition.id, next.id);
    return;
  }
  const roundRows = await getDb().select().from(schema.rounds).where(eq(schema.rounds.id, settledCompetition.roundId)).limit(1);
  const round = roundRows[0];
  if (!round) return;
  const nextSeasonRoundOne = await findFirstRoundCompetitionOfNextSeason(settledCompetition.sportId, round.seasonId);
  if (nextSeasonRoundOne) await tryClaimRollover(settledCompetition.id, nextSeasonRoundOne.id);
}

/**
 * Read-only lookup — unlike getOrCreateCompetition, this never writes a row. Used by
 * display-only pages (round page, results page) so simply *viewing* a round never has the
 * side effect of creating competition state; only an actual entry attempt does that.
 */
export async function getCompetitionForRound(sportId: number, roundId: number): Promise<DataResult<Competition | null>> {
  return safeQuery(async () => {
    const rows = await getDb()
      .select()
      .from(schema.competitions)
      .where(and(eq(schema.competitions.sportId, sportId), eq(schema.competitions.roundId, roundId)))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function getCompetitionById(competitionId: number): Promise<DataResult<Competition | null>> {
  return safeQuery(async () => {
    const rows = await getDb().select().from(schema.competitions).where(eq(schema.competitions.id, competitionId)).limit(1);
    return rows[0] ?? null;
  });
}

export type CloseCompetitionResult =
  | { status: "ok"; competition: Competition }
  | { status: "not_found" }
  | { status: "unavailable"; message: string };

/**
 * Closes a competition: no new entries after this, no changes to existing selections.
 * Idempotent — closing an already-closed (or already-settled) competition is a safe
 * no-op that returns the current row rather than erroring or double-transitioning state.
 * Intended to be called from a future scheduler/admin action; has no UI of its own.
 */
export async function closeCompetition(competitionId: number): Promise<CloseCompetitionResult> {
  const result = await safeQuery(async () => {
    const db = getDb();
    const rows = await db.select().from(schema.competitions).where(eq(schema.competitions.id, competitionId)).limit(1);
    const competition = rows[0];
    if (!competition) return null;

    // Already closed or settled — closing again must not corrupt or regress state.
    if (decideCloseAction(competition.status) === "noop") return competition;

    const updated = await db
      .update(schema.competitions)
      .set({ status: "closed" })
      .where(eq(schema.competitions.id, competitionId))
      .returning();
    return updated[0];
  });

  if (result.status === "unavailable") return result;
  if (!result.data) return { status: "not_found" };
  return { status: "ok", competition: result.data };
}

export type SetPrizePoolAllocationOverrideResult =
  | { status: "ok"; competition: Competition; previousBps: number | null }
  | { status: "not_found" }
  | { status: "already_settled" }
  | { status: "unavailable"; message: string };

/**
 * Sets (or clears, with null) this ONE competition's Phase 23E commercial-economics
 * override (competitions.prizePoolAllocationBps) — never touches prizeAmountCents,
 * rolloverInCents, or any other real prize-pool/settlement field. Passing null reverts
 * the competition to inheriting the global platform_settings default (see
 * src/lib/data/platform-settings.ts:getPrizePoolAllocationBps). Validation of the 0-10000
 * basis-points range happens in the caller (the API route) via
 * isValidPrizePoolAllocationBps, src/lib/perfect2/commercial.ts.
 *
 * Returns `previousBps` (the value before this call) alongside the updated row — this
 * field has no history table anywhere else, so it's the only way the caller's audit log
 * can record a real before/after pair instead of just the new value.
 *
 * Rejected once the competition has settled (prizeSettledAt is set): this figure is never
 * read by settlement/wallet code (it's purely a reporting/demonstration overlay, see the
 * module header), so editing it post-settlement can never move real money — but it CAN
 * silently rewrite what looks like a historical commercial-allocation record for a
 * competition that's already been paid out, which could disagree with whatever was
 * actually reported to a partner at the time. Blocking the edit here, the same way an
 * already-published Terms version is immutable, keeps that historical figure trustworthy.
 */
export async function setCompetitionPrizePoolAllocationOverride(competitionId: number, prizePoolAllocationBps: number | null): Promise<SetPrizePoolAllocationOverrideResult> {
  const result = await safeQuery(async () => {
    const db = getDb();
    const before = await db.select().from(schema.competitions).where(eq(schema.competitions.id, competitionId)).limit(1);
    if (!before[0]) return null;
    if (before[0].prizeSettledAt) return "already_settled" as const;
    const updated = await db
      .update(schema.competitions)
      .set({ prizePoolAllocationBps })
      .where(eq(schema.competitions.id, competitionId))
      .returning();
    return { competition: updated[0], previousBps: before[0].prizePoolAllocationBps };
  });
  if (result.status === "unavailable") return result;
  if (!result.data) return { status: "not_found" };
  if (result.data === "already_settled") return { status: "already_settled" };
  return { status: "ok", competition: result.data.competition, previousBps: result.data.previousBps };
}
