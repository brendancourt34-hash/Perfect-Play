import { notFound } from "next/navigation";
import { getAdminEntryDetail } from "@/lib/data/admin";
import { PerfectResultBadge, SelectionOutcomeBadge } from "@/components/result-badge";
import { PaymentStatusBadge } from "@/components/admin/payment-status-badge";
import { formatAudCents, formatAuDateTime } from "@/lib/utils/format";

function TransactionTypeBadge({ transactionType }: { transactionType: string }) {
  const isRefund = transactionType === "refund";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${
        isRefund ? "border-danger/40 text-danger" : "border-border text-muted"
      }`}
    >
      {transactionType}
    </span>
  );
}

export default async function AdminEntryDetailPage({ params }: { params: Promise<{ entryId: string }> }) {
  const { entryId: entryIdParam } = await params;
  const entryId = Number(entryIdParam);
  if (!Number.isInteger(entryId)) notFound();

  const result = await getAdminEntryDetail(entryId);
  if (result.status === "unavailable") return <p className="text-sm text-danger">{result.message}</p>;
  if (!result.data) notFound();
  const e = result.data;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted">
          {e.sportName} · {e.roundName ?? `Round ${e.roundNumber}`}
        </p>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-lg font-bold text-foreground">Entry #{e.entryId}</h1>
          <PerfectResultBadge result={e.result} />
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <InfoBox label="User" value={e.userName ? `${e.userName} (${e.userEmail})` : e.userEmail} />
        <InfoBox label="Entered" value={formatAuDateTime(e.enteredAt)} />
        <InfoBox label="Paid amount" value={e.paidAmountCents !== null ? formatAudCents(e.paidAmountCents) : "—"} />
        <div className="rounded-lg border border-border bg-surface p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Payment</p>
          <div className="mt-1">
            <PaymentStatusBadge status={e.paymentStatus} />
          </div>
        </div>
        <InfoBox label="Prize won" value={e.prizeAllocationCents > 0 ? formatAudCents(e.prizeAllocationCents) : "—"} />
      </section>

      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Payment transactions ({e.transactions.length})</h2>
        {e.transactions.length === 0 ? (
          <p className="text-sm text-muted">No transaction records linked to this entry yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {e.transactions.map((t) => (
              <div key={t.transactionId} className="rounded-lg border border-border bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-foreground">Transaction #{t.transactionId}</p>
                    <TransactionTypeBadge transactionType={t.transactionType} />
                  </div>
                  <PaymentStatusBadge status={t.status} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted">Amount</p>
                    <p className="font-medium text-foreground">{formatAudCents(t.amountCents)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Provider</p>
                    <p className="font-medium text-foreground">{t.provider}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Provider ref</p>
                    <p className="font-medium text-foreground">{t.providerTransactionId ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Recorded</p>
                    <p className="font-medium text-foreground">{formatAuDateTime(t.createdAt)}</p>
                  </div>
                </div>
                {t.failureMessage && (
                  <p className="mt-3 text-sm text-danger">
                    {t.failureCode ? `${t.failureCode}: ` : ""}
                    {t.failureMessage}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Selections ({e.selections.length})</h2>
        <div className="flex flex-col gap-3">
          {e.selections.map((s) => (
            <div key={s.gameId} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium text-foreground">
                  {s.homeTeamName} vs {s.awayTeamName}
                </p>
                <PerfectResultBadge result={s.gameResult} />
              </div>
              <div className="mt-3 flex flex-col gap-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted">{s.player1Name}</span>
                  <SelectionOutcomeBadge result={s.player1Result} />
                </div>
                {/* Null for every current (1-pick) sport — only present on a historical 2-pick entry. */}
                {s.player2Name != null && s.player2Result != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted">{s.player2Name}</span>
                    <SelectionOutcomeBadge result={s.player2Result} />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-sm font-bold text-foreground">{value}</p>
    </div>
  );
}
