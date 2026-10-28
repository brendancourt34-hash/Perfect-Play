import Link from "next/link";
import { notFound } from "next/navigation";
import { getSportConfig } from "@/lib/sports/config";
import { getGameDetail } from "@/lib/data/games";
import { getSelectionConfig } from "@/lib/perfect2/registry";
import { DataUnavailable } from "@/components/data-unavailable";
import { EmptyState } from "@/components/empty-state";
import { GameStatusChip } from "@/components/result-badge";
import { formatAuDateTime } from "@/lib/utils/format";

export default async function GamePage({
  params,
}: {
  params: Promise<{ sport: string; gameId: string }>;
}) {
  const { sport: sportSlug, gameId: gameIdParam } = await params;
  const sport = getSportConfig(sportSlug);
  if (!sport) notFound();

  const gameId = Number(gameIdParam);
  if (!Number.isInteger(gameId)) notFound();

  const detailResult = await getGameDetail(gameId);
  if (detailResult.status === "unavailable") {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <DataUnavailable context="This game" />
      </div>
    );
  }
  if (!detailResult.data) notFound();
  const { game, lineups, stats, players } = detailResult.data;

  const selectionConfig = getSelectionConfig(sport.code);
  const playerById = new Map(players.map((p) => [p.id, p]));
  const statsByPlayer = new Map(stats.map((s) => [s.playerId, s]));

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <Link href={`/${sport.slug}`} className="text-xs font-medium text-brand hover:underline">
        &larr; All {sport.name} rounds
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">
            {game.homeTeam?.name ?? "TBC"} vs {game.awayTeam?.name ?? "TBC"}
          </h1>
          <p className="mt-1 text-sm text-muted">{formatAuDateTime(game.kickoff)}</p>
          {game.venue && <p className="text-xs text-muted-2">{game.venue}</p>}
        </div>
        <GameStatusChip status={game.status} />
      </div>

      <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
        Pick any 2 players from either team as your {selectionConfig.selectionLabel.toLowerCase()}s — selections
        are entered from the round page, not restricted to any position.{" "}
        <Link href={`/${sport.slug}/rounds/${game.roundId}/enter`} className="font-medium text-brand hover:underline">
          Enter this round &rarr;
        </Link>
      </p>

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-foreground">Players in this game</h2>
        {lineups.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No lineup recorded"
              description="Team lists haven't been published for this game yet."
            />
          </div>
        ) : (
          <div className="mt-3 overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised text-left text-xs uppercase tracking-wide text-muted-2">
                <tr>
                  <th className="px-4 py-3 font-medium">Player</th>
                  <th className="px-4 py-3 font-medium">Position</th>
                  <th className="px-4 py-3 font-medium text-right">{selectionConfig.selectionLabel}s</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lineups.map((entry) => {
                  const player = playerById.get(entry.playerId);
                  const stat = statsByPlayer.get(entry.playerId);
                  const statCount = stat?.[selectionConfig.statField];
                  return (
                    <tr key={entry.id} className="bg-surface">
                      <td className="px-4 py-3 font-medium text-foreground">
                        {player ? `${player.firstName} ${player.lastName}` : "Unknown player"}
                        {!entry.isStarting && <span className="ml-2 text-xs text-muted-2">(bench)</span>}
                      </td>
                      <td className="px-4 py-3 text-muted">{entry.position}</td>
                      <td className="px-4 py-3 text-right font-mono text-muted">{statCount ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
