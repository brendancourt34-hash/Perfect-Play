import { WithdrawalsPanel } from "@/components/admin/withdrawals-panel";
import { listAllWithdrawals } from "@/lib/data/withdrawals";

export default async function AdminWithdrawalsPage() {
  const result = await listAllWithdrawals();
  if (result.status === "unavailable") {
    return <p className="text-sm text-danger">{result.message}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-bold text-foreground">Withdrawals</h1>
        <p className="mt-1 text-sm text-muted">
          Lifecycle and ledger only — no real payout mechanism exists yet. Marking a withdrawal completed debits the
          user&apos;s internal Perfect Play Balance ledger; it does not send real money anywhere.
        </p>
      </div>
      <WithdrawalsPanel
        initialWithdrawals={result.data.map((w) => ({
          id: w.id,
          userId: w.userId,
          userEmail: w.userEmail,
          amountCents: w.amountCents,
          status: w.status,
          adminNote: w.adminNote,
          requestedAt: w.requestedAt.toISOString(),
          processedAt: w.processedAt ? w.processedAt.toISOString() : null,
        }))}
      />
    </div>
  );
}
