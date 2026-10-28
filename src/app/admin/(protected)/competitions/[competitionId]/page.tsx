import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminCompetitionDetail, listAdminEntriesForCompetition } from "@/lib/data/admin";
import { CompetitionStateBadge, GameStatusChip } from "@/components/result-badge";
import { PaymentStatusBadge } from "@/components/admin/payment-status-badge";
import { CompetitionLifecycleActions } from "@/components/admin/competition-lifecycle-actions";
import { CommercialModelOverride } from "@/components/admin/commercial-model-override";
import { VoidGameButton } from "@/components/admin/void-game-button";
import { formatAudCents, formatAuDateTime } from "@/lib/utils/format";

export default async function AdminCompetitionDetailPage({ params }: { params: Promise<{ competitionId: string }> }) {
  const { competitionId: competitionIdParam } = await params;
  const competitionId = Number(competitionIdParam);
  if (!Number.isInteger(competitionId)) notFound();

  const [detailResult, entriesResult] = await Promise.all([
    getAdminCompetitionDetail(competitionId),
    listAdminEntriesForCompetition(competitionId),
  ]);
  if (detailResult.status === "unavailable") return <p className="text-sm text-danger">{detailResult.message}</p>;
  if (!detailResult.data) notFound();
  const c = detailResult.data;
  const entries = entriesResult.status === "ok" ? entriesResult.data : [];
  const roundLabel = c.roundName ?? `Round ${c.roundNumber}`;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted">{c.sportName} · {c.seasonLabel}</p>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-lg font-bold text-foreground">{roundLabel}</h1>
          <CompetitionStateBadge state={c.state} />
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <InfoBox label="Entry fee" value={formatAudCents(c.entryFeeCents)} />
        <InfoBox label="Current pool" value={formatAudCents(c.currentPrizePoolCents)} tone="brand" />
        <InfoBox label="Entries" value={String(c.entryCount)} />
        <InfoBox label="Data (settlement)" value={c.readiness.ready ? "Ready" : "Not ready"} tone={c.readiness.ready ? "brand" : "gold"} />
        <InfoBox label="Opens" value={c.opensAt ? formatAuDateTime(c.opensAt) : "—"} />
        <InfoBox label="Closes" value={c.closesAt ? formatAuDateTime(c.closesAt) : "—"} />
      </section>

      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Round lifecycle</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <InfoBox label="First game kickoff" value={c.firstGameKickoffAt ? formatAuDateTime(c.firstGameKickoffAt) : "Not yet scheduled"} />
          <InfoBox label="Buy-in cutoff" value={c.buyInCutoffAt ? formatAuDateTime(c.buyInCutoffAt) : "Not yet scheduled"} />
          <InfoBox label="Team lists" value={c.teamListsReady ? "Released" : "Not released"} tone={c.teamListsReady ? "brand" : "gold"} />
          <InfoBox label="Public prize pool" value={c.prizePoolVisible ? "Visible to customers" : "Hidden until kickoff"} tone={c.prizePoolVisible ? "brand" : "gold"} />
          <InfoBox label="Games with team lists" value={`${c.gamesWithCompletePlayerLists}/${c.gamesTotal}`} />
        </div>
        {c.readinessBlockers.length > 0 && (
          <p className="mt-2 text-xs text-gold">Blockers: {c.readinessBlockers.join(", ")}</p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Prize</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <InfoBox label="Base Prize" value={formatAudCents(c.prizeAmountCents)} />
          <InfoBox label="Rollover" value={formatAudCents(c.rolloverInCents)} tone={c.rolloverInCents > 0 ? "gold" : undefined} />
          <InfoBox label="Current Pool" value={formatAudCents(c.currentPrizePoolCents)} tone="brand" />
          {c.prizeSettledAt && (
            <>
              <InfoBox label="Winners" value={String(c.winnerCount)} tone={c.winnerCount > 0 ? "brand" : undefined} />
              <InfoBox label="Awarded" value={formatAudCents(c.awardedAmountCents)} />
              <InfoBox label="Rollover Out" value={formatAudCents(c.rolloverOutCents)} tone={c.rolloverOutCents > 0 ? "gold" : undefined} />
            </>
          )}
        </div>
        {c.prizeSettledAt && (
          <p className="mt-2 text-xs text-muted">
            Prize settled {formatAuDateTime(c.prizeSettledAt)} — immutable from this point (no admin action can edit these values).
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Commercial economics</h2>
        <p className="mb-3 text-xs text-muted">
          Commercial model — final allocation subject to commercial and regulatory agreement. This is a separate
          demonstration figure from the real Prize section above: it models what a share of collected entry money
          would look like, it is never the amount actually awarded to a winner.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <InfoBox label="Entry Revenue" value={formatAudCents(c.commercialEconomics.entryRevenueCents)} />
          <InfoBox label="Prize Pool Allocation" value={`${(c.commercialEconomics.prizePoolAllocationBps / 100).toFixed(2)}%`} />
          <InfoBox label="Modeled Prize Allocation" value={formatAudCents(c.commercialEconomics.modeledPrizePoolCents)} tone="brand" />
          <InfoBox label="Commercial Allocation" value={formatAudCents(c.commercialEconomics.commercialAllocationCents)} />
        </div>
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
            {c.commercialEconomics.isOverridden ? "Override for this competition" : "Inheriting global default — set an override:"}
          </p>
          <CommercialModelOverride
            competitionId={c.competitionId}
            currentBps={c.commercialEconomics.prizePoolAllocationBps}
            isOverridden={c.commercialEconomics.isOverridden}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Lifecycle</h2>
        <CompetitionLifecycleActions competitionId={c.competitionId} state={c.state} sportName={c.sportName} roundLabel={roundLabel} />
      </section>

      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Payments</h2>
        <div className="flex flex-wrap gap-2">
          <PaymentStatusBadge status="pending" /> <span className="text-sm text-muted">{c.paymentSummary.pending}</span>
          <PaymentStatusBadge status="paid" /> <span className="text-sm text-muted">{c.paymentSummary.paid}</span>
          <PaymentStatusBadge status="failed" /> <span className="text-sm text-muted">{c.paymentSummary.failed}</span>
          <PaymentStatusBadge status="cancelled" /> <span className="text-sm text-muted">{c.paymentSummary.cancelled}</span>
          <PaymentStatusBadge status="refunded" /> <span className="text-sm text-muted">{c.paymentSummary.refunded}</span>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Results</h2>
        <p className="text-sm text-muted">
          {c.resultSummary.perfect} perfect · {c.resultSummary.notPerfect} not perfect · {c.resultSummary.pending} pending
        </p>
        {c.state === "settled" && c.resultSummary.perfect > 0 && (
          <p className="mt-1 text-sm text-brand-text">
            {c.resultSummary.perfect} equal winner{c.resultSummary.perfect === 1 ? "" : "s"} — no ranking, prize pool split evenly.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Round analytics</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <InfoBox label="Unique customers" value={String(c.uniqueCustomers)} />
          <InfoBox label="Perfect customers" value={String(c.perfectCustomers)} tone={c.perfectCustomers > 0 ? "brand" : undefined} />
          <InfoBox label="Shared selection sets" value={String(c.sharedSelectionSetCount)} />
          <InfoBox
            label="Payout per PERFECT entry"
            value={c.payoutPerPerfectEntryCents !== null ? formatAudCents(c.payoutPerPerfectEntryCents) : "—"}
            tone={c.payoutPerPerfectEntryCents !== null ? "brand" : undefined}
          />
        </div>

        {c.packageDistribution.length > 0 && (
          <div className="mt-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Package mix</p>
            <div className="flex flex-wrap gap-2">
              {c.packageDistribution.map((p) => (
                <span key={p.entryCount} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-muted">
                  {p.entryCount}-entry: <span className="font-semibold text-foreground">{p.purchases}</span> purchase{p.purchases === 1 ? "" : "s"}
                </span>
              ))}
            </div>
          </div>
        )}

        {c.correctCountDistribution.length > 0 && (
          <div className="mt-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Correct-count distribution (entries)</p>
            <div className="flex flex-wrap gap-2">
              {c.correctCountDistribution
                .slice()
                .sort((a, b) => b.correctCount - a.correctCount)
                .map((row) => (
                  <span key={row.correctCount} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-muted">
                    {row.correctCount}/{c.gamesTotal}: <span className="font-semibold text-foreground">{row.entries}</span>
                  </span>
                ))}
            </div>
          </div>
        )}

        {c.selectionDistribution.length > 0 && (
          <div className="mt-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Selection distribution by game</p>
            <div className="flex flex-col gap-2">
              {c.selectionDistribution.map((g) => (
                <div key={g.gameId} className="rounded-lg border border-border bg-surface p-3">
                  <p className="text-xs font-semibold text-foreground">
                    {g.homeTeamName} vs {g.awayTeamName}
                  </p>
                  {g.players.length === 0 ? (
                    <p className="mt-1 text-xs text-muted">No picks yet.</p>
                  ) : (
                    <div className="mt-2 flex flex-col gap-1">
                      {g.players.map((p) => (
                        <div key={p.playerId} className="flex items-center justify-between text-xs">
                          <span className="text-muted">{p.playerName}</span>
                          <span className="text-foreground">
                            {p.pickCount} ({p.pickPercentage}%)
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Games ({c.games.length})</h2>
        {c.games.length === 0 ? (
          <p className="text-sm text-muted">No games scheduled yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {c.games.map((g) => (
              <div key={g.gameId} className="flex items-center justify-between rounded-lg border border-border bg-surface p-3 text-sm">
                <div>
                  <p className="font-medium text-foreground">
                    {g.homeTeamName} vs {g.awayTeamName}
                    {g.homeScore !== null && g.awayScore !== null ? ` (${g.homeScore}-${g.awayScore})` : ""}
                  </p>
                  <p className="text-xs text-muted">{formatAuDateTime(g.kickoff)}</p>
                  {(!g.hasLineups || !g.hasStatsIfFinal) && (
                    <p className="mt-1 text-xs text-gold">{!g.hasLineups ? "Missing lineup data" : "Final but stats not synced"}</p>
                  )}
                  {!g.teamListReady && <p className="mt-1 text-xs text-gold">Not selection-ready: {g.readinessBlockers.join(", ")}</p>}
                  <div className="mt-1">
                    <VoidGameButton gameId={g.gameId} status={g.status} />
                  </div>
                </div>
                <GameStatusChip status={g.status} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Entries ({entries.length})</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-muted">No entries yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-raised text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Entry</th>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Entered</th>
                  <th className="px-3 py-2">Payment</th>
                  <th className="px-3 py-2">Result</th>
                  <th className="px-3 py-2">Games</th>
                  <th className="px-3 py-2">Prize</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.entryId} className="border-t border-border">
                    <td className="px-3 py-2">
                      <Link href={`/admin/entries/${e.entryId}`} className="font-medium text-brand-text hover:underline">
                        #{e.entryId}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-muted">{e.userEmail}</td>
                    <td className="px-3 py-2 text-muted">{formatAuDateTime(e.enteredAt)}</td>
                    <td className="px-3 py-2">
                      <PaymentStatusBadge status={e.paymentStatus} />
                    </td>
                    <td className="px-3 py-2 text-muted">{e.result}</td>
                    <td className="px-3 py-2 text-muted">
                      {e.gamesCorrect}/{e.gamesTotal} correct{e.gamesPending > 0 ? `, ${e.gamesPending} pending` : ""}
                    </td>
                    <td className={`px-3 py-2 ${e.prizeAllocationCents > 0 ? "font-semibold text-brand-text" : "text-muted"}`}>
                      {e.prizeAllocationCents > 0 ? formatAudCents(e.prizeAllocationCents) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function InfoBox({ label, value, tone }: { label: string; value: string; tone?: "brand" | "gold" }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-sm font-bold ${tone === "brand" ? "text-brand-text" : tone === "gold" ? "text-gold" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
