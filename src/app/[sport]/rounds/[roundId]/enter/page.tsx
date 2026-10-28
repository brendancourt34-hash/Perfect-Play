import Link from "next/link";
import { notFound } from "next/navigation";
import { getSportConfig } from "@/lib/sports/config";
import { getRound } from "@/lib/data/rounds";
import { listGamesForRound, listEligiblePlayersForRound } from "@/lib/data/games";
import { getSportByCode } from "@/lib/data/sports";
import { getCompetitionForRound, type Competition } from "@/lib/data/competitions";
import { getSelectionConfig } from "@/lib/perfect2/registry";
import { getEffectiveCompetitionState } from "@/lib/competitions/lifecycle";
import { DataUnavailable } from "@/components/data-unavailable";
import { EmptyState } from "@/components/empty-state";
import { CompetitionStateBadge } from "@/components/result-badge";
import { formatAuDate, formatAudCents, formatSelectionTarget } from "@/lib/utils/format";
import { EntryForm, type EntryFormGame } from "./entry-form";

const DEFAULT_COMPETITION_PREVIEW = { status: "open" as const, opensAt: null, closesAt: null, entryFeeCents: 500, prizeAmountCents: 6000 };

export default async function EnterRoundPage({
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

  const [gamesResult, eligibleResult, sportResult] = await Promise.all([
    listGamesForRound(roundId),
    listEligiblePlayersForRound(roundId),
    getSportByCode(sport.code),
  ]);

  const selectionConfig = getSelectionConfig(sport.code);

  let competition: Pick<Competition, "status" | "opensAt" | "closesAt" | "entryFeeCents" | "prizeAmountCents"> =
    DEFAULT_COMPETITION_PREVIEW;
  if (sportResult.status === "ok" && sportResult.data) {
    const competitionResult = await getCompetitionForRound(sportResult.data.id, roundId);
    if (competitionResult.status === "ok" && competitionResult.data) competition = competitionResult.data;
  }
  const effectiveState = getEffectiveCompetitionState(competition);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Link href={`/${sport.slug}/rounds/${roundId}`} className="text-xs font-medium text-brand-text hover:underline">
        &larr; {roundLabel}
      </Link>

      <div className="mt-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Pick the Perfect Round — {sport.name}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {roundLabel}
          {round.startDate ? ` · ${formatAuDate(round.startDate)}` : ""} — pick a {selectionConfig.selectionLabel.toLowerCase()} for
          every game below. Any player from either team is eligible — there&apos;s no position restriction. Get
          every pick right to go PERFECT and take the entire pool. Entry fee: {formatAudCents(competition.entryFeeCents)}{" "}
          (payment isn&apos;t connected yet — this records your picks only).
        </p>
      </div>

      <div className="mt-8">
        {gamesResult.status === "unavailable" || eligibleResult.status === "unavailable" ? (
          <DataUnavailable context="Games and player lists for this round" />
        ) : gamesResult.data.length === 0 ? (
          <EmptyState
            title="No games scheduled yet"
            description="Fixtures for this round haven't been published yet."
          />
        ) : effectiveState !== "open" ? (
          // Server-enforced, not just a disabled button: createEntry independently
          // re-checks canAcceptEntries and rejects any direct submission attempt too.
          <div className="rounded-xl border border-border bg-surface-raised p-6 text-center">
            <CompetitionStateBadge state={effectiveState} className="mx-auto" />
            <p className="mt-3 text-sm text-muted">
              {effectiveState === "not_yet_open" && "Entries for this round haven't opened yet."}
              {effectiveState === "closed" && "This round is closed — no new entries are being accepted."}
              {effectiveState === "settled" && "This round has been settled."}
            </p>
            <Link
              href={
                effectiveState === "settled"
                  ? `/${sport.slug}/rounds/${roundId}/results`
                  : `/${sport.slug}/rounds/${roundId}`
              }
              className="mt-4 inline-block text-xs font-medium text-brand-text hover:underline"
            >
              {effectiveState === "settled" ? "View results" : "Back to round"} &rarr;
            </Link>
          </div>
        ) : (
          <EntryForm
            sportSlug={sport.slug}
            sportName={sport.name}
            roundId={roundId}
            roundLabel={roundLabel}
            selectionLabel={selectionConfig.selectionLabel}
            selectionTarget={formatSelectionTarget(selectionConfig.statField, selectionConfig.targetThreshold)}
            entryFeeCents={competition.entryFeeCents}
            closesAt={competition.closesAt}
            games={gamesResult.data.map((game): EntryFormGame => ({
              gameId: game.id,
              homeTeamName: game.homeTeam?.name ?? "TBC",
              awayTeamName: game.awayTeam?.name ?? "TBC",
              locked: game.status !== "scheduled",
              players: (eligibleResult.data.get(game.id) ?? []).map((p) => ({
                id: p.id,
                name: `${p.firstName} ${p.lastName}`,
                position: p.position,
                teamId: p.teamId,
              })),
            }))}
          />
        )}
      </div>
    </div>
  );
}
