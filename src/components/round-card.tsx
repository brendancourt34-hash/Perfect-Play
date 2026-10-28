import Link from "next/link";
import type { Round } from "@/lib/data/rounds";
import { formatAuDate, formatAudCents } from "@/lib/utils/format";
import { DateChip } from "./date-chip";

interface RoundCardProps {
  round: Round;
  sportSlug: string;
  gamesTotal?: number;
  /** Server-authoritative — null before the round's first game kicks off ("Revealed at kickoff" is shown instead), matching the same rule everywhere else a prize pool is displayed. */
  prizePoolVisible?: boolean;
  currentPrizePoolCents?: number | null;
  /** Sport-specific pre-reveal wording, e.g. "REVEALED AT FIRST BOUNCE" for AFL — defaults to the generic phrase when the caller doesn't pass one. */
  revealPhrase?: string;
}

export function RoundCard({ round, sportSlug, gamesTotal, prizePoolVisible, currentPrizePoolCents, revealPhrase = "REVEALED AT KICKOFF" }: RoundCardProps) {
  return (
    <Link
      href={`/${sportSlug}/rounds/${round.id}`}
      className="group flex items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-brand/30 sm:p-5"
    >
      <div>
        <p className="text-sm font-semibold text-foreground group-hover:text-brand">
          {round.name ?? `Round ${round.roundNumber}`}
        </p>
        <p className="mt-1 text-xs text-muted">
          {round.startDate ? formatAuDate(round.startDate) : "Date TBC"}
          {round.endDate ? ` – ${formatAuDate(round.endDate)}` : ""}
        </p>
        {typeof gamesTotal === "number" && (
          <p className="mt-1 text-xs text-muted-2">
            {gamesTotal} {gamesTotal === 1 ? "game" : "games"}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {round.startDate && <DateChip date={new Date(round.startDate)} />}
        <div className="flex flex-col items-end gap-1">
          {typeof prizePoolVisible === "boolean" &&
            (prizePoolVisible && currentPrizePoolCents !== null && currentPrizePoolCents !== undefined ? (
              <p className="text-sm font-bold text-brand">{formatAudCents(currentPrizePoolCents)}</p>
            ) : (
              <p className="rounded border border-border bg-surface-raised px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                {revealPhrase}
              </p>
            ))}
          <span className="text-xs font-medium text-brand opacity-0 transition-opacity group-hover:opacity-100">
            View round &rarr;
          </span>
        </div>
      </div>
    </Link>
  );
}
