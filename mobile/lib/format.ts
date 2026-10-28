/** Mirrors src/lib/utils/format.ts on the web — same rules, same Australian conventions. */

/** The short "target" tag shown next to a selection label, e.g. "1+ TRY" / "25+ POINTS" — so the correctness rule is never ambiguous. */
export function formatSelectionTarget(statField: "tries" | "goals" | "points" | "touchdowns", threshold: number): string {
  const noun =
    statField === "tries"
      ? threshold === 1
        ? "TRY"
        : "TRIES"
      : statField === "goals"
        ? threshold === 1
          ? "GOAL"
          : "GOALS"
        : statField === "touchdowns"
          ? threshold === 1
            ? "TOUCHDOWN"
            : "TOUCHDOWNS"
          : "POINTS";
  return `${threshold}+ ${noun}`;
}

export function formatAudCents(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function formatAuDateTime(value: string | null): string {
  if (!value) return "Kickoff TBC";
  const date = new Date(value);
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

export function formatAuDate(value: string | null): string {
  if (!value) return "TBC";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBC";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Australia/Sydney",
  }).format(date);
}

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
