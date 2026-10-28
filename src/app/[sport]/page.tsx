import { notFound } from "next/navigation";
import { getSportConfig, listSportSlugs } from "@/lib/sports/config";
import { getSportByCode } from "@/lib/data/sports";
import { getCurrentSeason, listSeasons } from "@/lib/data/seasons";
import { listRounds } from "@/lib/data/rounds";
import { DataUnavailable } from "@/components/data-unavailable";
import { EmptyState } from "@/components/empty-state";
import { RoundCard } from "@/components/round-card";

export function generateStaticParams() {
  return listSportSlugs().map((sport) => ({ sport }));
}

export default async function SportPage({
  params,
}: {
  params: Promise<{ sport: string }>;
}) {
  const { sport: sportSlug } = await params;
  const sport = getSportConfig(sportSlug);
  if (!sport) notFound();

  const sportResult = await getSportByCode(sport.code);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {sport.fullName} rounds
        </h1>
        <p className="mt-2 text-sm text-muted">{sport.ruleSummary}</p>
      </div>

      <RoundList sportResult={sportResult} sport={sport} />
    </div>
  );
}

async function RoundList({
  sportResult,
  sport,
}: {
  sportResult: Awaited<ReturnType<typeof getSportByCode>>;
  sport: ReturnType<typeof getSportConfig>;
}) {
  if (!sport) return null;

  if (sportResult.status === "unavailable" || !sportResult.data) {
    return <DataUnavailable context={`${sport.name} rounds`} />;
  }

  const seasonResult = await getCurrentSeason(sportResult.data.id);
  let season = seasonResult.status === "ok" ? seasonResult.data : null;

  if (!season) {
    const seasonsResult = await listSeasons(sportResult.data.id);
    season = seasonsResult.status === "ok" ? (seasonsResult.data[0] ?? null) : null;
  }

  if (!season) {
    return <DataUnavailable context={`${sport.name} rounds`} />;
  }

  const roundsResult = await listRounds(season.id);
  if (roundsResult.status === "unavailable") {
    return <DataUnavailable context={`${sport.name} rounds`} />;
  }

  if (roundsResult.data.length === 0) {
    return (
      <EmptyState
        title="No rounds scheduled yet"
        description={`Once fixtures are published for the ${sport.name} season, rounds will appear here.`}
      />
    );
  }

  return (
    <div className="space-y-3">
      {roundsResult.data.map((round) => (
        <RoundCard key={round.id} round={round} sportSlug={sport.slug} />
      ))}
    </div>
  );
}
