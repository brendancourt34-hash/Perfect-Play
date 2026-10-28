import Link from "next/link";
import { getCurrentUserForPage } from "@/lib/auth/require";
import { listEntryGroupsForUser, getEntryWithResult, type UserEntryGroupSummary } from "@/lib/data/entries";
import { getSportConfig } from "@/lib/sports/config";
import { DataUnavailable } from "@/components/data-unavailable";
import { EmptyState } from "@/components/empty-state";
import { PerfectResultBadge, SelectionOutcomeBadge } from "@/components/result-badge";
import { formatAudCents, formatStatLabel } from "@/lib/utils/format";

export const metadata = { title: "My Entries — Perfect Play" };

export default async function MyEntriesPage() {
  const user = await getCurrentUserForPage();

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">My Entries</h1>
        <div className="mt-8">
          <EmptyState title="Log in to view your entries" description="There's no web login yet — use the Perfect Play app to view and manage your entries." />
        </div>
      </div>
    );
  }

  const groupsResult = await listEntryGroupsForUser(user.id);
  if (groupsResult.status === "unavailable") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">My Entries</h1>
        <div className="mt-8">
          <DataUnavailable context="Your entries" />
        </div>
      </div>
    );
  }
  const groups = groupsResult.data;

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">My Entries</h1>
      <p className="mt-2 text-sm text-muted">
        Every entry you&apos;ve bought, grouped by round. A package purchase always uses ONE set of picks — every entry in a group is
        identical and settles independently.
      </p>

      {groups.length === 0 ? (
        <div className="mt-8">
          <EmptyState title="No entries yet" description="Enter a round to see it here." />
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-4">
          {groups.map((group) => (
            <EntryGroupCard key={group.competitionId} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}

async function EntryGroupCard({ group }: { group: UserEntryGroupSummary }) {
  const sport = getSportConfig(group.sportCode);
  const roundLabel = group.roundName ?? `Round ${group.roundNumber}`;
  const entryCount = group.entryIds.length;

  // The shared selection set is identical across every entry in the group (see
  // purchaseEntryPackage's "one canonical selection set" guarantee) — reading the FIRST
  // entry's settled picks is authoritative for the whole group, so this is shown ONCE,
  // never once per entry.
  const detailResult = await getEntryWithResult(group.entryIds[0]);
  const detail = detailResult.status === "ok" ? detailResult.data : null;

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted">
            {sport?.name ?? group.sportCode.toUpperCase()} — {roundLabel}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <p className="text-lg font-extrabold uppercase text-foreground">
              {entryCount} {entryCount === 1 ? "Entry" : "Entries"}
            </p>
            {entryCount > 1 && (
              <span className="rounded-full border border-brand/30 bg-brand-soft px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-text">
                Same Picks
              </span>
            )}
          </div>
        </div>
        <PerfectResultBadge result={group.result} />
      </div>

      {group.result === "perfect" && group.totalPrizeAllocationCents > 0 && (
        <div className="mt-4 rounded-xl border border-gold/40 bg-gold-soft p-4">
          <p className="text-sm font-extrabold uppercase text-gold">You Won</p>
          <p className="mt-1 text-xs text-gold">
            {entryCount} {entryCount === 1 ? "share" : "shares"}
            {group.competitionWinnerCount > 0 ? ` of ${group.competitionWinnerCount} total PERFECT entries` : ""}
          </p>
          <p className="mt-1 text-xl font-extrabold text-gold">{formatAudCents(group.totalPrizeAllocationCents)}</p>
        </div>
      )}

      {detail && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Your picks (shared by every entry above)</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {detail.selections.map((selection) => (
              <div key={selection.gameId} className="rounded-lg border border-border bg-surface-raised px-3 py-2">
                <p className="text-xs text-muted-2">
                  {selection.homeTeamName} vs {selection.awayTeamName}
                </p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-sm text-foreground">{selection.selections[0]?.name ?? "—"}</p>
                  <SelectionOutcomeBadge result={selection.selections[0]?.result ?? "pending"} />
                </div>
                {selection.selections[0]?.statCount !== null && (
                  <p className="mt-0.5 text-xs text-muted-2">{formatStatLabel(detail.statField, selection.selections[0]?.statCount ?? null)}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Individual entries</p>
        <div className="flex flex-wrap gap-2">
          {group.entryIds.map((entryId) => (
            <Link
              key={entryId}
              href={`/${sport?.slug ?? group.sportCode}/entries/${entryId}`}
              className="rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand/30 hover:text-foreground"
            >
              #{entryId}
            </Link>
          ))}
        </div>
      </div>

      <Link
        href={`/${sport?.slug ?? group.sportCode}/rounds/${group.roundId}/results`}
        className="mt-4 inline-block text-xs font-medium text-brand-text hover:underline"
      >
        View round results &rarr;
      </Link>
    </div>
  );
}
