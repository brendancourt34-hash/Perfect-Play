import { AutoRoundBuilder } from "@/components/admin/auto-round-builder";

export default function AdminNbaPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-bold text-foreground">NBA Rounds</h1>
        <p className="mt-1 text-sm text-muted">
          Sync the real live NBA schedule, then let Perfect Play randomly select exactly 8 eligible games (2 per day,
          Thursday–Sunday) using a stored, auditable seed — games are never chosen manually. Once locked, the round
          behaves exactly like any NRL/AFL round in Competitions — same entry, payment, prize-pool, and settlement flow.
        </p>
      </div>
      <AutoRoundBuilder sportCode="nba" sportName="NBA" syncMode="date-range" />
    </div>
  );
}
