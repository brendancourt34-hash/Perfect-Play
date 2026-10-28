"use client";

import { useState } from "react";
import { formatAudCents, formatAuDateTime } from "@/lib/utils/format";

interface WithdrawalRow {
  id: number;
  userId: number;
  userEmail: string;
  amountCents: number;
  status: string;
  adminNote: string | null;
  requestedAt: string;
  processedAt: string | null;
}

const TERMINAL = new Set(["completed", "rejected", "cancelled"]);

/**
 * Admin processing queue for withdrawal requests (Phase 23). This is lifecycle + ledger
 * only — there is no real payout mechanism yet (no licensing/KYC/AML process exists), so
 * "Mark completed" here only records the transition and debits the internal Perfect Play
 * Balance ledger; it does not send any real money anywhere. See
 * src/lib/data/withdrawals.ts.
 */
export function WithdrawalsPanel({ initialWithdrawals }: { initialWithdrawals: WithdrawalRow[] }) {
  const [withdrawals, setWithdrawals] = useState(initialWithdrawals);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updateStatus(id: number, status: string) {
    setUpdatingId(id);
    setError(null);
    const res = await fetch(`/api/admin/withdrawals/${id}/status`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const body = await res.json();
    setUpdatingId(null);
    if (!body.ok) {
      setError(body.message ?? "Update failed.");
      return;
    }
    setWithdrawals((prev) => prev.map((w) => (w.id === id ? { ...w, ...body.data.withdrawal } : w)));
  }

  if (withdrawals.length === 0) return <p className="text-sm text-muted">No withdrawal requests yet.</p>;

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-danger">{error}</p>}
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-muted">
            <th className="pb-2">User</th>
            <th className="pb-2">Amount</th>
            <th className="pb-2">Status</th>
            <th className="pb-2">Requested</th>
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody>
          {withdrawals.map((w) => (
            <tr key={w.id} className="border-t border-border align-top">
              <td className="py-2 text-foreground">{w.userEmail}</td>
              <td className="py-2 text-foreground">{formatAudCents(w.amountCents)}</td>
              <td className="py-2 text-foreground">{w.status}</td>
              <td className="py-2 text-muted">{formatAuDateTime(w.requestedAt)}</td>
              <td className="py-2">
                {TERMINAL.has(w.status) ? (
                  <span className="text-xs text-muted">Final</span>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {w.status === "requested" && (
                      <button onClick={() => updateStatus(w.id, "processing")} disabled={updatingId === w.id} className="rounded-md border border-border px-2 py-1 text-xs font-bold text-foreground disabled:opacity-50">
                        Start processing
                      </button>
                    )}
                    <button onClick={() => updateStatus(w.id, "completed")} disabled={updatingId === w.id} className="rounded-md bg-brand px-2 py-1 text-xs font-bold text-white disabled:opacity-50">
                      Mark completed
                    </button>
                    <button onClick={() => updateStatus(w.id, "rejected")} disabled={updatingId === w.id} className="rounded-md border border-border px-2 py-1 text-xs font-bold text-foreground disabled:opacity-50">
                      Reject
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
