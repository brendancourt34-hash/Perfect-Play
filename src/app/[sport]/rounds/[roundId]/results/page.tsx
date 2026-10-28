import Link from "next/link";
import { notFound } from "next/navigation";
import { getSportConfig } from "@/lib/sports/config";
import { getRound } from "@/lib/data/rounds";
import { listGamesForRound } from "@/lib/data/games";
import { getSportByCode } from "@/lib/data/sports";
import { getCompetitionForRound } from "@/lib/data/competitions";
import { getCompetitionResultsSummary } from "@/lib/data/settlement";
import { computeFirstGameKickoff, getEffectiveCompetitionState, hasFirstGameKickedOff } from "@/lib/competitions/lifecycle";
import { DataUnavailable } from "@/components/data-unavailable";
import { EmptyState } from "@/components/empty-state";
import { CompetitionStateBadge } from "@/components/result-badge";
import { getCurrentUserForPage } from "@/lib/auth/require";
import { listUserEntriesForCompetition } from "@/lib/data/entries";
import { formatAuDate, formatAudCents } from "@/lib/utils/format";

export default async function CompetitionResultsPage({
  params,
}: {
  params: Promise<{ sport: string; roundId: string }>;
}) {
  const { sport: sportSlug, roundId: roundIdParam } = await params;
  const sport = getSportConfig(sportSlug);
  if (!sport) notFound();

  const roundId = Number(roundIdParam);
  if (!Number.isInteger(roundId)) notFound();

  const roundResult = await getRound(roundId);
  if (roundResult.status === "unavailable") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <DataUnavailable context="This round" />
      </div>
    );
  }
  if (!roundResult.data) notFound();
  const round = roundResult.data;
  const roundLabel = round.name ?? `Round ${round.roundNumber}`;

  const sportResult = await getSportByCode(sport.code);
  if (sportResult.status === "unavailable") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <DataUnavailable context="Competition results" />
      </div>
    );
  }
  if (!sportResult.data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <EmptyState title="Results are not yet available" description="This competition hasn't been set up yet." />
      </div>
    );
  }

  const competitionResult = await getCompetitionForRound(sportResult.data.id, roundId);
  if (competitionResult.status === "unavailable") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <DataUnavailable context="Competition results" />
      </div>
    );
  }
  const competition = competitionResult.data;

  if (!competition) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <Link href={`/${sport.slug}/rounds/${roundId}`} className="text-xs font-medium text-brand hover:underline">
          &larr; {roundLabel}
        </Link>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {sport.name} — {roundLabel} Results
        </h1>
        <div className="mt-8">
          <EmptyState title="Results are not yet available" description="No one has entered this round yet." />
        </div>
      </div>
    );
  }

  const effectiveState = getEffectiveCompetitionState(competition);
  const user = await getCurrentUserForPage();
  const [summaryResult, gamesResult, myEntriesResult] = await Promise.all([
    getCompetitionResultsSummary(competition.id),
    listGamesForRound(roundId),
    user ? listUserEntriesForCompetition(user.id, competition.id) : Promise.resolve(null),
  ]);
  const summary = summaryResult.status === "ok" ? summaryResult.data : null;
  // Phase 23H: same "never reveal the real pool before the round's first game kicks off"
  // rule the JSON API already enforces — this page previously showed the raw
  // competition.prizeAmountCents unconditionally, which is the leak this now closes.
  const firstGameKickoff = gamesResult.status === "ok" ? computeFirstGameKickoff(gamesResult.data) : null;
  const prizePoolVisible = hasFirstGameKickedOff(firstGameKickoff);
  const isSettled = effectiveState === "settled";

  // The viewer's own PERFECT shares — never another customer's. Only meaningful once
  // settled; before that, myPerfectCount stays 0 and nothing is shown.
  const myPerfectCount =
    isSettled && myEntriesResult && myEntriesResult.status === "ok" ? myEntriesResult.data.filter((e) => e.result === "perfect").length : 0;
  const mySharesAmountCents = myPerfectCount > 0 && summary?.payoutPerPerfectEntryCents ? myPerfectCount * summary.payoutPerPerfectEntryCents : 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Link href={`/${sport.slug}/rounds/${roundId}`} className="text-xs font-medium text-brand hover:underline">
        &larr; {roundLabel}
      </Link>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {sport.name} — {roundLabel} Results
        </h1>
        <CompetitionStateBadge state={effectiveState} />
      </div>
      <p className="mt-1 text-sm text-muted-2">{round.startDate ? formatAuDate(round.startDate) : "Date TBC"}</p>

      {!summary ? (
        <div className="mt-8">
          <EmptyState title="No entries yet" description="No one has entered this round yet." />
        </div>
      ) : (
        <>
          {/* Never shown before kickoff/settlement: no entrant count, no live turnover, no
              live payout estimate — only the Prize Pool state itself (see Feature 2). */}
          <div className="mt-8 flex items-center justify-between rounded-xl border border-border bg-surface p-4 sm:p-5">
            <span className="text-sm text-muted-2">Prize Pool</span>
            <span className="text-lg font-bold text-foreground">
              {prizePoolVisible ? formatAudCents(summary.currentPrizePoolCents) : sport.revealPhrase}
            </span>
          </div>

          {myPerfectCount > 0 && (
            <div className="mt-6 rounded-xl border border-gold/40 bg-gold-soft p-4 sm:p-5">
              <p className="text-lg font-extrabold uppercase text-gold">You Won</p>
              <p className="mt-1 text-sm text-gold">
                {myPerfectCount} {myPerfectCount === 1 ? "SHARE" : "SHARES"} of the Prize Pool
              </p>
              <p className="mt-1 text-2xl font-extrabold text-gold">{formatAudCents(mySharesAmountCents)}</p>
            </div>
          )}

          <div className="mt-6">
            <h2 className="text-sm font-semibold text-foreground">Winners</h2>
            {!isSettled ? (
              <p className="mt-2 text-sm text-muted">Results aren&apos;t final yet — check back once every game in the round has finished.</p>
            ) : summary.perfectCount === 0 ? (
              <p className="mt-2 text-sm text-muted">NO PERFECT ENTRIES. THE POOL ROLLS OVER TO THE NEXT ROUND.</p>
            ) : (
              <>
                <p className="mt-2 text-sm text-muted">
                  {summary.perfectCount} PERFECT {summary.perfectCount === 1 ? "ENTRY" : "ENTRIES"}
                  {summary.payoutPerPerfectEntryCents !== null && (
                    <>
                      {" "}
                      — <span className="font-semibold text-foreground">{formatAudCents(summary.payoutPerPerfectEntryCents)}</span> PER PERFECT
                      ENTRY
                    </>
                  )}
                  .{" "}
                  {summary.perfectCount > 1 ? "More than one entry went PERFECT, so the pool is split evenly across every PERFECT entry." : ""}
                </p>
                <ul className="mt-3 space-y-2">
                  {summary.perfectEntryIds.map((id) => (
                    <li key={id} className="rounded-lg border border-gold/40 bg-gold-soft px-3 py-2 text-sm text-gold">
                      Entry #{id}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
