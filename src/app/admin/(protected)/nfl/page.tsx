import { AutoRoundBuilder } from "@/components/admin/auto-round-builder";

export default function AdminNflPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-bold text-foreground">NFL Rounds</h1>
        <p className="mt-1 text-sm text-muted">
          A Perfect Play NFL round is exactly 8 games, randomly selected by the server from that week&apos;s eligible real
          fixture using a stored, auditable seed — games are never chosen manually. The sports-data provider for NFL is
          not yet configured (see Settings), so generation will honestly report insufficient eligible games until real
          NFL schedule data exists — nothing here fabricates a game.
        </p>
      </div>
      <AutoRoundBuilder sportCode="nfl" sportName="NFL" syncMode="provider-round" />
    </div>
  );
}
