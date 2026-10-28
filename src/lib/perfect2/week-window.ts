/**
 * Pure calendar-week helpers for day-bucketed round shapes (NBA's fixed Thursday-Sunday
 * window today — see round-shape.ts). All grouping is done in Perfect Play's canonical
 * Australian display timezone (Australia/Sydney), never the provider's own timezone
 * (ESPN's NBA kickoff timestamps are US-based) — a game the customer sees as "Friday
 * night AEST" must be grouped into the Friday bucket even if it's still Thursday
 * afternoon in the US. Every function here is pure (no I/O, no Date.now()) so it's
 * trivially unit-testable and safe to call from both the generator and its tests.
 */

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/** Sydney-local calendar date as YYYY-MM-DD, independent of the instant's UTC offset. */
export function sydneyDateString(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(instant);
}

/** Lowercase Sydney-local weekday name, e.g. "thursday". */
export function sydneyWeekdayName(instant: Date): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", weekday: "long" }).format(instant).toLowerCase();
}

/** Adds/subtracts whole calendar days to a YYYY-MM-DD string, returned in the same format — pure calendar-date arithmetic, never affected by DST (anchored at UTC noon so a +-1hr DST shift can never roll the date over). */
function shiftDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d, 12));
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return anchor.toISOString().slice(0, 10);
}

/**
 * The Sydney-local date (YYYY-MM-DD) of `roundDays[0]` (e.g. "thursday") that starts the
 * window containing `instant`. A Sunday-night game and the Thursday four days earlier
 * both resolve to the SAME week-start date — that's the entire point: it's the key every
 * game in one valid Perfect Play NBA round must share.
 */
export function weekStartForInstant(instant: Date, roundDays: readonly string[]): string {
  const startDayIndex = WEEKDAY_INDEX[roundDays[0].toLowerCase()];
  const instantDayIndex = WEEKDAY_INDEX[sydneyWeekdayName(instant)];
  const daysSinceStart = (instantDayIndex - startDayIndex + 7) % 7;
  return shiftDateString(sydneyDateString(instant), -daysSinceStart);
}

/** The following week's start date, 7 calendar days after `weekStartDate`. */
export function nextWeekStart(weekStartDate: string): string {
  return shiftDateString(weekStartDate, 7);
}
