import { getAdminDashboard } from "@/lib/data/admin";
import { StatCard, StatGroup } from "@/components/admin/stat-card";
import { formatAudCents } from "@/lib/utils/format";

export default async function AdminDashboardPage() {
  const result = await getAdminDashboard();
  if (result.status === "unavailable") {
    return <p className="text-sm text-danger">{result.message}</p>;
  }
  const d = result.data;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-lg font-bold text-foreground">Dashboard</h1>

      <StatGroup title="Competitions">
        <StatCard label="Open" value={d.competitions.open} tone="brand" />
        <StatCard label="Closed" value={d.competitions.closed} tone="gold" />
        <StatCard label="Settled" value={d.competitions.settled} />
      </StatGroup>

      <StatGroup title="Entries">
        <StatCard label="Total" value={d.entries.total} />
        {d.entries.bySport.map((s) => (
          <StatCard key={s.sportCode} label={s.sportName} value={s.entryCount} />
        ))}
      </StatGroup>

      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Payments (entries)</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard label="Pending" value={d.payments.pending} />
          <StatCard label="Paid" value={d.payments.paid} tone="brand" />
          <StatCard label="Failed" value={d.payments.failed} tone="danger" />
          <StatCard label="Cancelled" value={d.payments.cancelled} />
          <StatCard label="Refunded" value={d.payments.refunded} tone="gold" />
        </div>

        <div className="mb-3 mt-6 flex items-baseline justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wide text-muted">Sport economics</h3>
          <span className="text-xs text-muted">Prize pool allocation: {(d.entries.prizePoolAllocationBps / 100).toFixed(2)}%</span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-raised text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Sport</th>
                <th className="px-3 py-2">Entries</th>
                <th className="px-3 py-2">Entry revenue</th>
                <th className="px-3 py-2">Prize pool</th>
                <th className="px-3 py-2">Commercial allocation</th>
              </tr>
            </thead>
            <tbody>
              {d.entries.bySport.map((s) => (
                <tr key={s.sportCode} className="border-t border-border">
                  <td className="px-3 py-2 font-medium text-foreground">{s.sportName}</td>
                  <td className="px-3 py-2 text-muted">{s.entryCount.toLocaleString()}</td>
                  <td className="px-3 py-2 text-foreground">{formatAudCents(s.totalEntryValueCents)}</td>
                  <td className="px-3 py-2 text-brand-text">{formatAudCents(s.modeledPrizePoolCents)}</td>
                  <td className="px-3 py-2 text-muted">{formatAudCents(s.commercialAllocationCents)}</td>
                </tr>
              ))}
              <tr className="border-t border-border bg-surface-raised font-bold">
                <td className="px-3 py-2 text-foreground">Total</td>
                <td className="px-3 py-2 text-foreground">{d.entries.total.toLocaleString()}</td>
                <td className="px-3 py-2 text-foreground">{formatAudCents(d.entries.totalEntryValueCents)}</td>
                <td className="px-3 py-2 text-brand-text">{formatAudCents(d.entries.totalModeledPrizePoolCents)}</td>
                <td className="px-3 py-2 text-foreground">{formatAudCents(d.entries.totalCommercialAllocationCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          Commercial model — final allocation subject to commercial and regulatory agreement. Prize Pool here is a
          modeled figure for business demonstration only; it is not the same as a round&apos;s actual configured prize
          pool (see each competition&apos;s own detail page).
        </p>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted">Perfect rate &amp; rollover, by sport</h2>
          <span className="text-xs text-muted">Compare against the simulation tool&apos;s expected rate</span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-raised text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Sport</th>
                <th className="px-3 py-2">Unique customers</th>
                <th className="px-3 py-2">Perfect entries</th>
                <th className="px-3 py-2">Perfect customers</th>
                <th className="px-3 py-2">Perfect rate</th>
                <th className="px-3 py-2">Rollovers</th>
                <th className="px-3 py-2">Rollover amount</th>
                <th className="px-3 py-2">Package mix (1 / 5 / 10)</th>
              </tr>
            </thead>
            <tbody>
              {d.entries.bySport.map((s) => {
                const mix = (n: number) => s.packageMix.find((p) => p.entryCount === n)?.purchases ?? 0;
                return (
                  <tr key={s.sportCode} className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">{s.sportName}</td>
                    <td className="px-3 py-2 text-muted">{s.uniqueCustomers.toLocaleString()}</td>
                    <td className="px-3 py-2 text-muted">{s.perfectEntries.toLocaleString()}</td>
                    <td className="px-3 py-2 text-muted">{s.perfectCustomers.toLocaleString()}</td>
                    <td className="px-3 py-2 text-brand-text">{s.perfectRatePct}%</td>
                    <td className="px-3 py-2 text-muted">{s.rolloverCount}</td>
                    <td className="px-3 py-2 text-gold">{formatAudCents(s.rolloverAmountCents)}</td>
                    <td className="px-3 py-2 text-muted">
                      {mix(1)} / {mix(5)} / {mix(10)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <StatGroup title="Payment transactions">
        <StatCard label="Pending" value={d.transactions.pending} />
        <StatCard label="Paid" value={d.transactions.paid} tone="brand" />
        <StatCard label="Failed" value={d.transactions.failed} tone="danger" />
        <StatCard label="Cancelled" value={d.transactions.cancelled} />
        <StatCard label="Refunded" value={d.transactions.refunded} tone="gold" />
        <StatCard label="Refund attempts" value={d.transactions.refundAttempts} tone={d.transactions.refundAttempts > 0 ? "gold" : undefined} />
      </StatGroup>

      <StatGroup title="Results">
        <StatCard label="Pending" value={d.results.pending} />
        <StatCard label="Perfect" value={d.results.perfect} tone="brand" />
        <StatCard label="Not Perfect" value={d.results.notPerfect} tone="danger" />
      </StatGroup>

      <StatGroup title="Data readiness (settlement)">
        <StatCard label="Checked" value={d.data.competitionsChecked} />
        <StatCard label="Ready" value={d.data.ready} tone="brand" />
        <StatCard label="Not ready" value={d.data.notReady} tone={d.data.notReady > 0 ? "gold" : undefined} />
      </StatGroup>

      <div className="flex flex-col gap-3 sm:flex-row">
        {d.sportsDataProviders.map((p) => (
          <div key={p.label} className="flex-1 rounded-lg border border-border bg-surface p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{p.label}</p>
            <p className="mt-1 text-sm font-bold text-foreground">
              {p.provider === "none" && "Not configured"}
              {p.provider === "mock" && "Mock (dev/test fixture — not real data)"}
              {p.provider === "champion-data" && "Champion Data (not yet connected — no credentials configured)"}
              {p.provider === "nba-espn" && "ESPN (live, real, keyless public API)"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
