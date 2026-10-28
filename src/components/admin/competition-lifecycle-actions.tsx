"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EffectiveCompetitionState } from "@/lib/competitions/lifecycle";

/**
 * Only shows the action valid for the competition's current state (open -> close,
 * closed -> settle, settled -> nothing) and requires an explicit confirmation click
 * before calling the real admin API route, which delegates to the existing
 * close/settle orchestration — this component never updates status itself, it only
 * triggers the server-side action and refreshes the page with whatever actually happened.
 */
export function CompetitionLifecycleActions({
  competitionId,
  state,
  sportName,
  roundLabel,
}: {
  competitionId: number;
  state: EffectiveCompetitionState;
  sportName: string;
  roundLabel: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<"close" | "settle" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function perform(action: "close" | "settle") {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/admin/competitions/${competitionId}/${action}`, { method: "POST", credentials: "include" });
    const body = await res.json();
    setLoading(false);
    if (!body.ok) {
      setError(body.errors?.[0] ?? body.message ?? "Action failed.");
      return;
    }
    setConfirming(null);
    router.refresh();
  }

  if (state === "settled") {
    return <span className="text-xs font-bold uppercase tracking-wide text-muted">Settled — no further action</span>;
  }

  if (confirming === "close") {
    return (
      <div className="rounded-lg border border-border bg-surface-raised p-4">
        <p className="font-semibold text-foreground">Close competition?</p>
        <p className="mt-1 text-sm text-muted">
          {sportName} {roundLabel} — entries will no longer be accepted.
        </p>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-3 flex gap-2">
          <button onClick={() => setConfirming(null)} className="rounded-md border border-border px-3 py-1.5 text-sm text-muted">
            Cancel
          </button>
          <button
            onClick={() => perform("close")}
            disabled={loading}
            className="rounded-md bg-gold px-3 py-1.5 text-sm font-semibold text-background disabled:opacity-50"
          >
            {loading ? "Closing…" : "Close competition"}
          </button>
        </div>
      </div>
    );
  }

  if (confirming === "settle") {
    return (
      <div className="rounded-lg border border-border bg-surface-raised p-4">
        <p className="font-semibold text-foreground">Settle competition?</p>
        <p className="mt-1 text-sm text-muted">This calculates final results using the available sports data.</p>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-3 flex gap-2">
          <button onClick={() => setConfirming(null)} className="rounded-md border border-border px-3 py-1.5 text-sm text-muted">
            Cancel
          </button>
          <button
            onClick={() => perform("settle")}
            disabled={loading}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? "Settling…" : "Settle"}
          </button>
        </div>
      </div>
    );
  }

  if (state === "closed") {
    return (
      <button onClick={() => setConfirming("settle")} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white">
        Settle competition
      </button>
    );
  }

  // "open" or "not_yet_open"
  return (
    <button onClick={() => setConfirming("close")} className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-background">
      Close competition
    </button>
  );
}
