import Link from "next/link";
import { listAdminCompetitions } from "@/lib/data/admin";
import { CompetitionStateBadge } from "@/components/result-badge";
import { formatAudCents, formatAuDateTime } from "@/lib/utils/format";

export default async function AdminCompetitionsPage() {
  const result = await listAdminCompetitions();
  if (result.status === "unavailable") {
    return <p className="text-sm text-danger">{result.message}</p>;
  }
  const competitions = result.data;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-bold text-foreground">Competitions</h1>

      {competitions.length === 0 ? (
        <p className="text-sm text-muted">No competitions exist yet — one is created the first time a round accepts an entry.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {competitions.map((c) => (
            <Link
              key={c.competitionId}
              href={`/admin/competitions/${c.competitionId}`}
              className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4 hover:border-brand/40"
            >
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">{c.sportName}</p>
                <p className="text-base font-semibold text-foreground">{c.roundName ?? `Round ${c.roundNumber}`}</p>
                <p className="mt-1 text-xs text-muted">
                  {formatAudCents(c.entryFeeCents)} entry · {formatAudCents(c.currentPrizePoolCents)} pool
                  {c.rolloverInCents > 0 && ` (${formatAudCents(c.prizeAmountCents)} base + ${formatAudCents(c.rolloverInCents)} rollover)`} ·{" "}
                  {c.entryCount} {c.entryCount === 1 ? "entry" : "entries"}
                </p>
                {c.prizeSettledAt && (
                  <p className="mt-1 text-xs text-muted">
                    {c.winnerCount} winner{c.winnerCount === 1 ? "" : "s"} · {formatAudCents(c.awardedAmountCents)} awarded
                    {c.rolloverOutCents > 0 && ` · ${formatAudCents(c.rolloverOutCents)} rolled over`}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted">
                  {c.teamListsReady ? "Team lists ready" : `Not selection-ready (${c.readinessBlockers.join(", ") || "no games"})`}
                  {c.buyInCutoffAt && ` · Buy-in cutoff ${formatAuDateTime(c.buyInCutoffAt)}`}
                  {` · Pool ${c.prizePoolVisible ? "publicly visible" : "hidden until kickoff"}`}
                </p>
              </div>
              <CompetitionStateBadge state={c.state} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
