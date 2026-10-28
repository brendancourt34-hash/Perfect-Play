"use client";

import { useState } from "react";
import { formatAudCents } from "@/lib/utils/format";

interface EntryPackage {
  id: number;
  entryCount: number;
  priceCents: number;
  label: string;
  badge: string | null;
  active: boolean;
  displayOrder: number;
}

interface PlatformSettingsPanelProps {
  initialMaxEntries: number;
  initialPackages: EntryPackage[];
  /** Basis points (6000 = 60%) — see src/lib/data/platform-settings.ts:getPrizePoolAllocationBps. */
  initialPrizePoolAllocationBps: number;
}

/**
 * Admin controls for the two Phase 23 configurable business rules: the max-entries-per-
 * round cap and the entry-package catalog. Neither is hard-coded in application logic —
 * see src/lib/data/platform-settings.ts and src/lib/data/entry-packages.ts. Editing a
 * package only ever affects NEW purchases; a purchase already made keeps its own recorded
 * price/entry count forever (see wallet_transactions/competition_entries), so changing
 * prices here is never retroactive. Initial data is fetched server-side (the page.tsx
 * server component) and passed down as props, matching this app's convention (see
 * AdminCompetitionsPage) — no client-side fetch-on-mount, only fetches triggered by an
 * explicit admin action (save/create/toggle).
 */
export function PlatformSettingsPanel({ initialMaxEntries, initialPackages, initialPrizePoolAllocationBps }: PlatformSettingsPanelProps) {
  const [maxEntries, setMaxEntries] = useState<string>(String(initialMaxEntries));
  const [maxEntriesSaving, setMaxEntriesSaving] = useState(false);
  const [maxEntriesMessage, setMaxEntriesMessage] = useState<string | null>(null);

  const [prizePoolPercent, setPrizePoolPercent] = useState<string>(String(initialPrizePoolAllocationBps / 100));
  const [prizePoolSaving, setPrizePoolSaving] = useState(false);
  const [prizePoolMessage, setPrizePoolMessage] = useState<string | null>(null);

  const [packages, setPackages] = useState<EntryPackage[]>(initialPackages);

  const [savingPackageId, setSavingPackageId] = useState<number | null>(null);

  const [newEntryCount, setNewEntryCount] = useState("");
  const [newPriceDollars, setNewPriceDollars] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newBadge, setNewBadge] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function saveMaxEntries() {
    const value = Number(maxEntries);
    if (!Number.isInteger(value) || value <= 0) {
      setMaxEntriesMessage("Enter a positive whole number.");
      return;
    }
    setMaxEntriesSaving(true);
    setMaxEntriesMessage(null);
    const res = await fetch("/api/admin/settings/max_entries_per_round", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    const body = await res.json();
    setMaxEntriesSaving(false);
    setMaxEntriesMessage(body.ok ? "Saved. Applies to entries purchased from now on." : (body.message ?? "Save failed."));
  }

  async function savePrizePoolPercent() {
    const percent = Number(prizePoolPercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      setPrizePoolMessage("Enter a percentage between 0 and 100.");
      return;
    }
    const bps = Math.round(percent * 100);
    setPrizePoolSaving(true);
    setPrizePoolMessage(null);
    const res = await fetch("/api/admin/settings/prize_pool_allocation_bps", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: bps }),
    });
    const body = await res.json();
    setPrizePoolSaving(false);
    setPrizePoolMessage(body.ok ? "Saved. Applies to the dashboard's commercial-economics model from now on." : (body.message ?? "Save failed."));
  }

  async function togglePackageActive(pkg: EntryPackage) {
    setSavingPackageId(pkg.id);
    const res = await fetch(`/api/admin/entry-packages/${pkg.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !pkg.active }),
    });
    const body = await res.json();
    setSavingPackageId(null);
    if (body.ok) setPackages((prev) => prev.map((p) => (p.id === pkg.id ? body.data.package : p)));
  }

  async function createPackage() {
    const entryCount = Number(newEntryCount);
    const priceCents = Math.round(Number(newPriceDollars) * 100);
    if (!Number.isInteger(entryCount) || entryCount <= 0) {
      setCreateError("Entry count must be a positive whole number.");
      return;
    }
    if (!Number.isFinite(priceCents) || priceCents <= 0) {
      setCreateError("Price must be a positive dollar amount.");
      return;
    }
    if (!newLabel.trim()) {
      setCreateError("Label is required.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    const res = await fetch("/api/admin/entry-packages", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryCount, priceCents, label: newLabel.trim(), badge: newBadge.trim() || null, displayOrder: packages.length }),
    });
    const body = await res.json();
    setCreating(false);
    if (!body.ok) {
      setCreateError(body.errors?.[0] ?? body.message ?? "Failed to create package.");
      return;
    }
    setPackages((prev) => [...prev, body.data.package]);
    setNewEntryCount("");
    setNewPriceDollars("");
    setNewLabel("");
    setNewBadge("");
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Max entries per user per round</h2>
        <p className="mb-3 text-sm text-muted">
          Applied independently per sport per round. Editing this never retroactively changes a round that&apos;s already open.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            value={maxEntries}
            onChange={(e) => setMaxEntries(e.target.value)}
            className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
          <button
            onClick={saveMaxEntries}
            disabled={maxEntriesSaving}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-bold text-black disabled:opacity-50"
          >
            {maxEntriesSaving ? "Saving…" : "Save"}
          </button>
          {maxEntriesMessage && <span className="text-xs text-muted">{maxEntriesMessage}</span>}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Commercial model</h2>
        <p className="mb-3 text-sm text-muted">
          Used for commercial modelling only. The final commercial structure may be agreed separately with a licensed
          wagering partner.
        </p>
        <div className="flex flex-wrap items-end gap-6">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Prize pool allocation
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={prizePoolPercent}
                onChange={(e) => setPrizePoolPercent(e.target.value)}
                className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              />
              <span className="text-sm text-foreground">%</span>
              <button
                onClick={savePrizePoolPercent}
                disabled={prizePoolSaving}
                className="rounded-md bg-brand px-3 py-1.5 text-sm font-bold text-black disabled:opacity-50"
              >
                {prizePoolSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </label>
          <div className="flex flex-col gap-1 text-xs text-muted">
            Remaining commercial allocation
            <span className="text-sm font-bold text-foreground">{(100 - (Number(prizePoolPercent) || 0)).toFixed(2)}%</span>
          </div>
        </div>
        {prizePoolMessage && <p className="mt-2 text-xs text-muted">{prizePoolMessage}</p>}
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Entry packages</h2>
        {packages.length === 0 ? (
          <p className="text-sm text-muted">No packages yet — add one below.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted">
                <th className="pb-2">Label</th>
                <th className="pb-2">Entries</th>
                <th className="pb-2">Price</th>
                <th className="pb-2">Badge</th>
                <th className="pb-2">Active</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {packages.map((pkg) => (
                <tr key={pkg.id} className="border-t border-border">
                  <td className="py-2 text-foreground">{pkg.label}</td>
                  <td className="py-2 text-foreground">{pkg.entryCount}</td>
                  <td className="py-2 text-foreground">{formatAudCents(pkg.priceCents)}</td>
                  <td className="py-2 text-muted">{pkg.badge ?? "—"}</td>
                  <td className="py-2 text-foreground">{pkg.active ? "Yes" : "No"}</td>
                  <td className="py-2">
                    <button
                      onClick={() => togglePackageActive(pkg)}
                      disabled={savingPackageId === pkg.id}
                      className="rounded-md border border-border px-2 py-1 text-xs font-bold text-foreground disabled:opacity-50"
                    >
                      {pkg.active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Entry count
            <input type="number" min={1} value={newEntryCount} onChange={(e) => setNewEntryCount(e.target.value)} className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Price ($)
            <input type="number" min={0} step="0.01" value={newPriceDollars} onChange={(e) => setNewPriceDollars(e.target.value)} className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Label
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. 5 Entries" className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Badge (optional)
            <input value={newBadge} onChange={(e) => setNewBadge(e.target.value)} placeholder="e.g. BEST VALUE" className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
          </label>
          <button onClick={createPackage} disabled={creating} className="rounded-md bg-brand px-3 py-1.5 text-sm font-bold text-black disabled:opacity-50">
            {creating ? "Adding…" : "Add package"}
          </button>
        </div>
        {createError && <p className="mt-2 text-xs text-muted">{createError}</p>}
      </section>
    </div>
  );
}
