import { RoundBuilder } from "@/components/admin/round-builder";

export default function AdminAflPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-bold text-foreground">AFL Rounds</h1>
        <p className="mt-1 text-sm text-muted">
          A Perfect Play AFL round is a curated group of games the admin selects, based on the actual fixture — the round
          size is fully configurable, never a fixed universal number.
        </p>
      </div>
      <RoundBuilder sportCode="afl" sportName="AFL" syncMode="provider-round" />
    </div>
  );
}
