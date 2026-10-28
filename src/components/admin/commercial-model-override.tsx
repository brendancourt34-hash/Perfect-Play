"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Sets or clears ONE competition's Phase 23E prize-pool-allocation override — a
 * commercial-demonstration figure only, never the real prizeAmountCents/rollover
 * settlement fields (see src/lib/data/competitions.ts:setCompetitionPrizePoolAllocationOverride).
 * Clearing an override reverts the competition to inheriting the global default set at
 * /admin/settings.
 */
export function CommercialModelOverride({ competitionId, currentBps, isOverridden }: { competitionId: number; currentBps: number; isOverridden: boolean }) {
  const router = useRouter();
  const [percent, setPercent] = useState(String(currentBps / 100));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(prizePoolAllocationBps: number | null) {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/admin/competitions/${competitionId}/commercial-model`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prizePoolAllocationBps }),
    });
    const body = await res.json();
    setSaving(false);
    if (!body.ok) {
      setError(body.message ?? "Save failed.");
      return;
    }
    router.refresh();
  }

  function saveOverride() {
    const value = Number(percent);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      setError("Enter a percentage between 0 and 100.");
      return;
    }
    submit(Math.round(value * 100));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="number"
        min={0}
        max={100}
        step="0.01"
        value={percent}
        onChange={(e) => setPercent(e.target.value)}
        className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
      />
      <span className="text-sm text-foreground">%</span>
      <button onClick={saveOverride} disabled={saving} className="rounded-md bg-brand px-2 py-1 text-xs font-bold text-black disabled:opacity-50">
        {saving ? "Saving…" : "Save override"}
      </button>
      {isOverridden && (
        <button onClick={() => submit(null)} disabled={saving} className="rounded-md border border-border px-2 py-1 text-xs font-bold text-foreground disabled:opacity-50">
          Reset to global default
        </button>
      )}
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
