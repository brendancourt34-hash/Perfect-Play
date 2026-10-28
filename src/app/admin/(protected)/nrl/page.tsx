import { RoundBuilder } from "@/components/admin/round-builder";

export default function AdminNrlPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-bold text-foreground">NRL Rounds</h1>
        <p className="mt-1 text-sm text-muted">
          A Perfect Play NRL round is a curated group of games the admin selects — not an automatic mirror of the official
          fixture. Normally that&apos;s 8 games, but the round size is fully configurable: during State of Origin or a
          bye-heavy week, select however many suitable games actually exist (e.g. 6). The pick/settlement engine adapts
          automatically to however many games are selected — nothing here is hard-coded to a fixed count.
        </p>
      </div>
      <RoundBuilder sportCode="nrl" sportName="NRL" syncMode="provider-round" />
    </div>
  );
}
