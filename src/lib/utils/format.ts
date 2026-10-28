/** Australian date/time formatting helpers, used throughout the UI. */

export function formatAuDate(value: Date | string | null | undefined): string {
  if (!value) return "TBC";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "TBC";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Australia/Sydney",
  }).format(date);
}

export function formatAuDateTime(value: Date | string | null | undefined): string {
  if (!value) return "Kickoff TBC";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "Kickoff TBC";
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Australia/Sydney",
  }).format(date);
}

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Formats a whole-cents integer (e.g. competitions.entryFeeCents/prizeAmountCents) as an
 * AUD amount. Never hardcode "$5"/"$60" in a component — always read the configured cents
 * value from the competition row and format it here.
 */
/** "1 try" / "0 tries" / "2 goals" / "24 points" — the sport-specific stat wording used on entry results. */
export function formatStatLabel(statField: "tries" | "goals" | "points" | "touchdowns", count: number | null): string {
  if (count === null) return "Pending";
  const noun =
    statField === "tries"
      ? count === 1
        ? "try"
        : "tries"
      : statField === "goals"
        ? count === 1
          ? "goal"
          : "goals"
        : statField === "touchdowns"
          ? count === 1
            ? "touchdown"
            : "touchdowns"
          : "points";
  return `${count} ${noun}`;
}

/**
 * The short "target" tag shown next to a selection label so a user is never confused
 * about what makes a pick correct — e.g. "1+ TRY", "25+ POINTS". Purely a display helper;
 * the actual threshold comparison lives in src/lib/perfect2/settle.ts's settleSelection.
 */
export function formatSelectionTarget(statField: "tries" | "goals" | "points" | "touchdowns", threshold: number): string {
  const noun =
    statField === "tries" ? (threshold === 1 ? "TRY" : "TRIES") : statField === "goals" ? (threshold === 1 ? "GOAL" : "GOALS") : statField === "touchdowns" ? (threshold === 1 ? "TOUCHDOWN" : "TOUCHDOWNS") : "POINTS";
  return `${threshold}+ ${noun}`;
}

export function formatAudCents(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
