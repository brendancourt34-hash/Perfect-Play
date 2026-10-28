import Link from "next/link";
import { notFound } from "next/navigation";
import { getSportConfig } from "@/lib/sports/config";
import { getEntryWithResult } from "@/lib/data/entries";
import { DataUnavailable } from "@/components/data-unavailable";
import { PerfectResultBadge, SelectionOutcomeBadge } from "@/components/result-badge";
import { formatStatLabel } from "@/lib/utils/format";
import type { EntryResult } from "@/lib/perfect2/types";

const ENTRY_RESULT_COPY: Record<EntryResult, { heading: string; description: string }> = {
  perfect: { heading: "PERFECT", description: "You went PERFECT. Congratulations — your entry got every selection correct." },
  not_perfect: { heading: "NOT PERFECT", description: "Not PERFECT this time. You missed the perfect round." },
  pending: { heading: "PENDING", description: "Your round is still in play. Keep watching — your PERFECT result isn't decided yet." },
};

export default async function EntryResultPage({
  params,
}: {
  params: Promise<{ sport: string; entryId: string }>;
}) {
  const { sport: sportSlug, entryId: entryIdParam } = await params;
  const sport = getSportConfig(sportSlug);
  if (!sport) notFound();

  const entryId = Number(entryIdParam);
  if (!Number.isInteger(entryId)) notFound();

  const result = await getEntryWithResult(entryId);
  if (result.status === "unavailable") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <DataUnavailable context="This entry" />
      </div>
    );
  }
  if (!result.data || result.data.sportCode !== sport.code) notFound();
  const entry = result.data;
  const copy = ENTRY_RESULT_COPY[entry.entryResult];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Link href={`/${sport.slug}/rounds/${entry.roundId}`} className="text-xs font-medium text-brand-text hover:underline">
        &larr; Back to round
      </Link>

      <div className="mt-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{copy.heading}</h1>
        <PerfectResultBadge result={entry.entryResult} />
      </div>
      <p className="mt-1 text-sm text-muted">{copy.description}</p>
      <p className="mt-1 text-xs text-muted-2">Entry #{entry.entryId} — Perfect Play {sport.name}. No points involved.</p>

      <div className="mt-8 space-y-3">
        {entry.selections.map((selection) => (
          <div key={selection.gameId} className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-foreground">
                {selection.homeTeamName} vs {selection.awayTeamName}
              </p>
              <PerfectResultBadge result={selection.gameResult} />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {selection.selections.map((pick) => (
                <div key={pick.id} className="flex items-center justify-between rounded-lg border border-border bg-surface-raised px-3 py-2">
                  <div>
                    <p className="text-sm text-foreground">{pick.name}</p>
                    <p className="text-xs text-muted-2">{formatStatLabel(entry.statField, pick.statCount)}</p>
                  </div>
                  <SelectionOutcomeBadge result={pick.result} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Link
        href={`/${sport.slug}/rounds/${entry.roundId}/results`}
        className="mt-6 inline-block text-xs font-medium text-brand-text hover:underline"
      >
        View full competition results &rarr;
      </Link>
    </div>
  );
}
