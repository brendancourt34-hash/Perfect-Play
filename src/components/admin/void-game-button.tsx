"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Admin resolution for a real-world postponed/cancelled game (Phase 22 §20/21) — marks
 * the game cancelled and voids every pending selection referencing it. Never invents a
 * correct/incorrect result. The route lives at /api/admin/nba/void-game but isn't
 * sport-specific — any sport's game can be voided this way (see src/lib/data/void.ts).
 */
export function VoidGameButton({ gameId, status }: { gameId: number; status: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deliberately still shown for "cancelled" (unlike "final"): a provider resync can mark
  // a game cancelled on its own, and voidGame is safe to call again on an already-cancelled
  // game — it only ever touches selections still "pending", so this remains a real
  // recourse if any were ever left un-voided (e.g. by a path that predates that safeguard).
  if (status === "final") return null;

  async function submit() {
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setLoading(true);
    setError(null);
    const res = await fetch("/api/admin/nba/void-game", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId, reason }),
    });
    const body = await res.json();
    setLoading(false);
    if (!body.ok) {
      setError(body.message ?? "Failed to void game.");
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className="text-xs font-semibold text-danger underline">
        Void (postponed/cancelled)
      </button>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-border bg-surface-raised p-2">
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (e.g. postponed, will not be replayed)"
        className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button onClick={() => setConfirming(false)} className="rounded-md border border-border px-2 py-1 text-xs text-muted">
          Cancel
        </button>
        <button onClick={submit} disabled={loading} className="rounded-md bg-danger px-2 py-1 text-xs font-semibold text-background disabled:opacity-50">
          {loading ? "Voiding…" : "Confirm void"}
        </button>
      </div>
    </div>
  );
}
