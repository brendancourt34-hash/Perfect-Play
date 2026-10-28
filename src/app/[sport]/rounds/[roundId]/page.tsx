import Link from "next/link";
import { notFound } from "next/navigation";
import { getSportConfig } from "@/lib/sports/config";
import { getRound } from "@/lib/data/rounds";
import { listGamesForRound } from "@/lib/data/games";
import { getSportByCode } from "@/lib/data/sports";
import { getCompetitionForRound, type Competition } from "@/lib/data/competitions";
import { getSelectionConfig } from "@/lib/perfect2/registry";
import { computeFirstGameKickoff, getEffectiveCompetitionState, hasFirstGameKickedOff } from "@/lib/competitions/lifecycle";
import { DataUnavailable } from "@/components/data-unavailable";
import { EmptyState } from "@/components/empty-state";
import { GameCard } from "@/components/game-card";
import { CompetitionStateBadge } from "@/components/result-badge";
import { formatAuDate, formatAuDateTime, formatAudCents } from "@/lib/utils/format";

// Games and eligibility exist but no competition row has been created yet — this is the
// same open/$5/$60 shape a real row would get from getOrCreateCompetition's defaults,
// used purely for display so a round doesn't need a DB write just to be viewed.
const DEFAULT_COMPETITION_PREVIEW = { status: "open" as const, opensAt: null, closesAt: null, entryFeeCents: 500, prizeAmountCents: 6000, rolloverInCents: 0 };

export default async function RoundPage({
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
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <DataUnavailable context="This round" />
      </div>
    );
  }
  if (!roundResult.data) notFound();
  const round = roundResult.data;

  const [gamesResult, sportResult] = await Promise.all([listGamesForRound(roundId), getSportByCode(sport.code)]);
  const selectionConfig = getSelectionConfig(sport.code);
  const hasGames = gamesResult.status === "ok" && gamesResult.data.length > 0;

  let competition: Pick<Competition, "status" | "opensAt" | "closesAt" | "entryFeeCents" | "prizeAmountCents" | "rolloverInCents"> =
    DEFAULT_COMPETITION_PREVIEW;
  if (hasGames && sportResult.status === "ok" && sportResult.data) {
    const competitionResult = await getCompetitionForRound(sportResult.data.id, roundId);
    if (competitionResult.status === "ok" && competitionResult.data) competition = competitionResult.data;
  }
  const effectiveState = getEffectiveCompetitionState(competition);

  // Phase 23H: the real, current-facing public prize pool must never be shown before the
  // round's first game kicks off — same rule the JSON API (/api/[sport]/rounds/[roundId])
  // already enforces; this page previously showed the raw base prizeAmountCents
  // unconditionally, which is the leak this now closes.
  const firstGameKickoff = hasGames && gamesResult.status === "ok" ? computeFirstGameKickoff(gamesResult.data) : null;
  const prizePoolVisible = hasFirstGameKickedOff(firstGameKickoff);
  const currentPrizePoolCents = competition.prizeAmountCents + competition.rolloverInCents;

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <Link href={`/${sport.slug}`} className="text-xs font-medium text-brand hover:underline">
        &larr; All {sport.name} rounds
      </Link>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {sport.name} — {round.name ?? `Round ${round.roundNumber}`}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {round.startDate ? formatAuDate(round.startDate) : "Date TBC"}
            {round.endDate ? ` – ${formatAuDate(round.endDate)}` : ""}
          </p>
        </div>

        {hasGames && (
          <div className="flex items-center gap-3">
            <CompetitionStateBadge state={effectiveState} />
            {effectiveState === "open" && (
              <Link
                href={`/${sport.slug}/rounds/${round.id}/enter`}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-brand-strong"
              >
                Enter Perfect Play — {formatAudCents(competition.entryFeeCents)}
              </Link>
            )}
            {effectiveState === "settled" && (
              <Link
                href={`/${sport.slug}/rounds/${round.id}/results`}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-background transition-colors hover:bg-brand-strong"
              >
                View Results
              </Link>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-2">
        <span>
          Entry: <span className="font-semibold text-foreground">{formatAudCents(competition.entryFeeCents)}</span>
        </span>
        <span>
          Prize:{" "}
          <span className="font-semibold text-foreground">
            {prizePoolVisible ? formatAudCents(currentPrizePoolCents) : sport.revealPhrase}
          </span>
        </span>
        {competition.opensAt && effectiveState === "not_yet_open" && <span>Opens {formatAuDateTime(competition.opensAt)}</span>}
        {competition.closesAt && (effectiveState === "open" || effectiveState === "not_yet_open") && (
          <span>Closes {formatAuDateTime(competition.closesAt)}</span>
        )}
      </div>

      <p className="mt-2 text-xs text-muted-2">
        Pick a {selectionConfig.selectionLabel.toLowerCase()} for every game in this round — any player, any
        position. Get every pick right to go PERFECT and take the entire pool. This is a separate competition from
        every other sport.
      </p>

      <div className="mt-8">
        {gamesResult.status === "unavailable" ? (
          <DataUnavailable context="Game results and lineups for this round" />
        ) : gamesResult.data.length === 0 ? (
          <EmptyState
            title="No games scheduled yet"
            description="Fixtures for this round haven't been published yet."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {gamesResult.data.map((game) => (
              <Link key={game.id} href={`/${sport.slug}/games/${game.id}`} className="block">
                <GameCard game={game} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
