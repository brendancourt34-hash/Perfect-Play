import type { GameWithTeams } from "@/lib/data/games";
import { formatAuDateTime } from "@/lib/utils/format";
import { GameStatusChip } from "./result-badge";

interface GameCardProps {
  game: GameWithTeams;
}

export function GameCard({ game }: GameCardProps) {
  const hasScore = game.homeScore !== null && game.awayScore !== null;

  return (
    <div className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-brand/30 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-2">
          {formatAuDateTime(game.kickoff)}
        </span>
        <GameStatusChip status={game.status} />
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">{game.homeTeam?.name ?? "TBC"}</span>
          {hasScore && <span className="font-mono text-sm text-muted">{game.homeScore}</span>}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">{game.awayTeam?.name ?? "TBC"}</span>
          {hasScore && <span className="font-mono text-sm text-muted">{game.awayScore}</span>}
        </div>
      </div>

      {game.venue && <p className="mt-3 text-xs text-muted-2">{game.venue}</p>}
    </div>
  );
}
