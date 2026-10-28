/**
 * Per-sport ROUND SHAPE — a distinct concern from SportSelectionConfig (which governs
 * settlement: stat/threshold/label). This governs admin-side round CURATION: how many
 * games a round must contain, how many per day, and which days.
 *
 * NRL/AFL are deliberately UNCONSTRAINED (gamesPerRound: null) — a Perfect Play round is a
 * curated group of games the admin selects (src/lib/data/schedule-pool.ts), not a mirror
 * of the official fixture, so it can keep running every week with however many suitable
 * games exist that week: 8 in a normal week, 6 during State of Origin or a bye-heavy
 * week, or any other count — never a hard-coded universal number. `recommendedGamesPerRound`
 * is a UI hint only (e.g. "normally 8") — it is never enforced; only NBA has an actually
 * enforced fixed shape: exactly 8 games, all from the SAME real Thursday-Sunday calendar
 * week (see week-window.ts) — a defined Perfect Play NBA product rule, not a fixture
 * quirk. `gamesPerDay` (2) is only a PREFERENCE for how those 8 are spread across the
 * window, never a hard per-day floor — the real NBA schedule is often uneven day-to-day.
 *
 * Nothing in the core entry/selection/settlement engine reads this — settlement, HIT/MISS,
 * completion, and winning already derive entirely from the round's ACTUAL games (see
 * settleEntry/settleEntrySelections in settle.ts and every UI that computes `games.length`
 * dynamically), so a 6-game round and an 8-game round settle identically, just with a
 * different total. This file exists purely so admin round-creation can validate itself,
 * and so a future sport with its own curated shape only needs a new entry here.
 */
export interface SportRoundShapeConfig {
  sportCode: string;
  /** Null = unconstrained — any number of curated games is valid. */
  gamesPerRound: number | null;
  /** A PREFERENCE for how gamesPerRound should be spread across roundDays (e.g. NBA's 2/day) — the generator aims for this but backfills from other days when one falls short; never a hard per-day floor. Null = no day structure at all. */
  gamesPerDay: number | null;
  /** Lowercase day names, in order, e.g. ["thursday","friday","saturday","sunday"]. Null = no day structure. */
  roundDays: readonly string[] | null;
  /** Display-only hint for the admin UI (e.g. "normally 8 games") — never validated against. */
  recommendedGamesPerRound: number | null;
}

const UNCONSTRAINED: SportRoundShapeConfig = { sportCode: "", gamesPerRound: null, gamesPerDay: null, roundDays: null, recommendedGamesPerRound: null };

const ROUND_SHAPES: Record<string, SportRoundShapeConfig> = {
  nrl: { ...UNCONSTRAINED, sportCode: "nrl", recommendedGamesPerRound: 8 },
  // Phase 23F: AFL rounds moved from a recommended 8 games to 9 — still unconstrained
  // (a bye-heavy week can still publish with fewer), just a different UI hint.
  afl: { ...UNCONSTRAINED, sportCode: "afl", recommendedGamesPerRound: 9 },
  nba: { sportCode: "nba", gamesPerRound: 8, gamesPerDay: 2, roundDays: ["thursday", "friday", "saturday", "sunday"], recommendedGamesPerRound: 8 },
  // Phase 23F — new sport: NFL rounds are curated from a much larger weekly fixture (the
  // admin picks 8 games out of ~16), the same "unconstrained, recommended 8" pattern as
  // NRL — never a fixed schedule shape like NBA's, since NFL has no equivalent fixed
  // weekly broadcast cadence Perfect Play can rely on.
  nfl: { ...UNCONSTRAINED, sportCode: "nfl", recommendedGamesPerRound: 8 },
};

export function getRoundShapeConfig(sportCode: string): SportRoundShapeConfig {
  return ROUND_SHAPES[sportCode] ?? { ...UNCONSTRAINED, sportCode };
}

export interface RoundShapeValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a proposed set of curated games (gameId -> slotLabel, e.g. "thursday")
 * against the sport's shape. Unconstrained sports (NRL/AFL) always pass — they don't
 * curate. Deliberately pure/synchronous: no DB access, so it's trivially unit-testable
 * and reusable by any admin action that assembles a round.
 */
export function validateRoundShape(
  sportCode: string,
  slotAssignments: readonly { slotLabel: string | null; weekStartDate?: string | null }[],
): RoundShapeValidationResult {
  const shape = getRoundShapeConfig(sportCode);
  const errors: string[] = [];

  // Unconstrained sports (NRL/AFL): any number of curated games is valid, with or
  // without a day label — this is exactly what lets a 6-game Origin-week round and an
  // 8-game normal-week round both publish successfully.
  if (shape.gamesPerRound === null) return { valid: true, errors: [] };

  if (slotAssignments.length !== shape.gamesPerRound) {
    errors.push(`${shape.sportCode.toUpperCase()} rounds require exactly ${shape.gamesPerRound} games (got ${slotAssignments.length}).`);
  }

  if (shape.roundDays) {
    const allowedDays = new Set(shape.roundDays);
    for (const a of slotAssignments) {
      if (!a.slotLabel || !allowedDays.has(a.slotLabel)) {
        errors.push(`"${a.slotLabel ?? "(none)"}" is not a valid day for a ${shape.sportCode.toUpperCase()} round — must be one of: ${shape.roundDays.join(", ")}.`);
      }
    }
  }

  // gamesPerDay (e.g. NBA's 2) is a PREFERENCE for the generator to aim for, never a hard
  // per-day floor here — the real NBA schedule (NBA Cup weeks etc.) routinely produces an
  // uneven split (e.g. 1/3/2/2) within an otherwise perfectly valid 8-game week, and
  // rejecting that would silently skip real, playable weeks. The only per-day rule this
  // validates is that every game's day actually belongs to the sport's round days (the
  // check above) — the day-by-day COUNT is intentionally unconstrained as long as the
  // total (checked above) and same-week (checked below) requirements hold.

  // Defense-in-depth: for a day-bucketed sport, every game must come from the SAME real
  // Thursday-Sunday week — never a scattered mix of unrelated weeks/months. Best-effort:
  // only enforced when the caller actually supplies weekStartDate for every assignment
  // (the real NBA generate/lock path always does; callers that don't pass it — e.g.
  // existing tests exercising only the count/day checks — simply skip this check rather
  // than fail on missing data they were never asked to provide).
  if (shape.roundDays) {
    const weeks = slotAssignments.map((a) => a.weekStartDate);
    if (weeks.every((w) => w !== undefined)) {
      const distinctWeeks = new Set(weeks.filter((w): w is string => w !== null));
      if (distinctWeeks.size > 1) {
        errors.push(`All ${shape.sportCode.toUpperCase()} games in a round must belong to the same Thursday-Sunday week (found weeks: ${[...distinctWeeks].sort().join(", ")}).`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
