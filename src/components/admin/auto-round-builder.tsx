"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getRoundShapeConfig } from "@/lib/perfect2/round-shape";
import { getSelectionConfig } from "@/lib/perfect2/registry";

interface SelectedGame {
  gameId: number;
  homeTeamName: string;
  awayTeamName: string;
  kickoff: string;
  dayLabel: string | null;
}

interface SelectionState {
  id: number;
  seed: string;
  status: "generated" | "locked";
  generatedAt: string;
  lockedAt: string | null;
  roundId: number | null;
}

interface AutoRoundBuilderProps {
  sportCode: string;
  sportName: string;
  /** NBA syncs by a real calendar date range (no upstream "round" concept); NFL syncs one provider round at a time, same as NRL/AFL. */
  syncMode: "date-range" | "provider-round";
}

/**
 * Automated NBA/NFL round-building workflow (replaces manual game-by-game curation for
 * these two sports — see src/lib/perfect2/game-selection.ts and
 * src/lib/data/auto-round-selection.ts). The server owns every decision: the seed, the
 * shuffle, and the resulting 8 games. This component only ever asks the server to
 * "generate", "regenerate", or "lock" — it never computes or supplies the selection
 * itself. NRL/AFL keep using the existing manual RoundBuilder untouched.
 */
export function AutoRoundBuilder({ sportCode, sportName, syncMode }: AutoRoundBuilderProps) {
  const router = useRouter();

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [seasonExternalId, setSeasonExternalId] = useState("");
  const [roundExternalId, setRoundExternalId] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<number | null>(null);

  const [roundNumber, setRoundNumber] = useState("");
  const [roundName, setRoundName] = useState("");

  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [games, setGames] = useState<SelectedGame[]>([]);
  const [generating, setGenerating] = useState(false);
  const [locking, setLocking] = useState(false);
  const [actionError, setActionError] = useState<string[] | null>(null);

  const shapeConfig = useMemo(() => getRoundShapeConfig(sportCode), [sportCode]);
  const selectionConfig = useMemo(() => getSelectionConfig(sportCode), [sportCode]);
  const totalPicks = (shapeConfig.gamesPerRound ?? 0) * selectionConfig.selectionsPerGame;
  const ruleSummary = `${shapeConfig.gamesPerRound} games · ${totalPicks} player picks · ${selectionConfig.selectionLabel}`;
  const countByDay = useMemo(() => {
    if (!shapeConfig.roundDays) return null;
    const counts: Record<string, number> = {};
    for (const d of shapeConfig.roundDays) counts[d] = 0;
    for (const g of games) if (g.dayLabel) counts[g.dayLabel] = (counts[g.dayLabel] ?? 0) + 1;
    return counts;
  }, [games, shapeConfig.roundDays]);

  const roundNumberInt = Number(roundNumber);
  const canQuery = !!seasonId && Number.isInteger(roundNumberInt) && roundNumberInt > 0;

  // Mirrors React's own documented data-fetching-in-an-effect pattern exactly (an inner
  // async function, an `ignore` guard, setState only ever called AFTER the awaited
  // response resolves) — no setState is reachable synchronously from the effect body, so
  // this satisfies react-hooks/set-state-in-effect without losing the fetch-on-dependency-
  // change behavior.
  const loadSelection = useCallback(async () => {
    if (!canQuery) return { exists: false, selection: null, games: [] as SelectedGame[] };
    const res = await fetch(`/api/admin/rounds/auto-selection?sportCode=${sportCode}&seasonId=${seasonId}&roundNumber=${roundNumberInt}`, { credentials: "include" });
    const body = await res.json();
    if (body.ok && body.data.exists) return { exists: true, selection: body.data.selection as SelectionState, games: body.data.games as SelectedGame[] };
    return { exists: false, selection: null, games: [] as SelectedGame[] };
  }, [canQuery, sportCode, seasonId, roundNumberInt]);

  useEffect(() => {
    let ignore = false;
    loadSelection().then((result) => {
      if (ignore) return;
      setSelection(result.selection);
      setGames(result.games);
    });
    return () => {
      ignore = true;
    };
  }, [loadSelection]);

  async function syncSchedule() {
    setSyncing(true);
    setSyncError(null);
    setSyncMessage(null);
    const endpoint = syncMode === "date-range" ? "/api/admin/nba/sync-schedule" : "/api/admin/rounds/sync-provider-round";
    const payload = syncMode === "date-range" ? { startDate, endDate } : { sportCode, sportName, seasonExternalId, roundExternalId };
    const res = await fetch(endpoint, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await res.json();
    setSyncing(false);
    if (!body.ok) {
      setSyncError(body.errors?.[0] ?? body.message ?? "Sync failed.");
      return;
    }
    setSeasonId(body.data.seasonId);
    setSyncMessage(`Synced ${body.data.games.inserted + body.data.games.updated} real games from the live ${sportName} schedule.`);
  }

  async function generate() {
    if (!seasonId || !roundNumberInt) return;
    setGenerating(true);
    setActionError(null);
    const res = await fetch("/api/admin/rounds/auto-selection/generate", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sportCode, seasonId, roundNumber: roundNumberInt }),
    });
    const body = await res.json();
    setGenerating(false);
    if (!body.ok) {
      setActionError(body.errors ?? [body.message ?? "Generation failed."]);
      return;
    }
    setSelection(body.data.selection);
    setGames(body.data.games);
  }

  async function regenerate() {
    if (!seasonId || !roundNumberInt) return;
    setGenerating(true);
    setActionError(null);
    const res = await fetch("/api/admin/rounds/auto-selection/regenerate", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sportCode, seasonId, roundNumber: roundNumberInt }),
    });
    const body = await res.json();
    setGenerating(false);
    if (!body.ok) {
      setActionError(body.errors ?? [body.message ?? "Regeneration failed."]);
      return;
    }
    setSelection(body.data.selection);
    setGames(body.data.games);
  }

  async function lock() {
    if (!seasonId || !roundNumberInt || !roundName) {
      setActionError(["A round name is required before locking."]);
      return;
    }
    setLocking(true);
    setActionError(null);
    const res = await fetch("/api/admin/rounds/auto-selection/lock", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sportCode, seasonId, roundNumber: roundNumberInt, roundName }),
    });
    const body = await res.json();
    setLocking(false);
    if (!body.ok) {
      setActionError(body.errors ?? [body.message ?? "Locking failed."]);
      return;
    }
    router.push(`/admin/competitions`);
  }

  const isLocked = selection?.status === "locked";

  return (
    <div className="flex flex-col gap-6">
      <p className="rounded-md border border-border bg-surface-raised px-3 py-2 text-xs font-medium text-muted">
        Automatic mode — the server randomly selects eligible {sportName} games using a stored, auditable seed. Games are never
        chosen manually.{" "}
        {shapeConfig.roundDays
          ? `Every round is exactly ${shapeConfig.gamesPerRound} games, all from the same real ${shapeConfig.roundDays.map((d) => d[0].toUpperCase() + d.slice(1)).join("-")} week — preferably ${shapeConfig.gamesPerDay} per day, though an uneven split (e.g. an NBA Cup week) is accepted as long as the total and same-week requirements hold.`
          : null}
      </p>
      <p className="rounded-md border border-border bg-surface-raised px-3 py-2 text-xs font-medium text-muted">{ruleSummary}</p>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">1. Sync the real {sportName} schedule</h2>
        {syncMode === "date-range" ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Window start
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Window end
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
            </label>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Season external ID
              <input type="text" value={seasonExternalId} onChange={(e) => setSeasonExternalId(e.target.value)} className="w-48 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Round external ID
              <input type="text" value={roundExternalId} onChange={(e) => setRoundExternalId(e.target.value)} className="w-48 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
            </label>
          </div>
        )}
        <div className="mt-3">
          <button
            onClick={syncSchedule}
            disabled={syncing || (syncMode === "date-range" ? !startDate || !endDate : !seasonExternalId || !roundExternalId)}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-background disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "Sync real schedule"}
          </button>
        </div>
        {syncMessage && <p className="mt-2 text-sm text-brand">{syncMessage}</p>}
        {syncError && <p className="mt-2 text-sm text-danger">{syncError}</p>}
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">2. Automatic Game Selection</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Round number
            <input type="number" value={roundNumber} onChange={(e) => setRoundNumber(e.target.value)} className="w-28 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Round name
            <input
              type="text"
              value={roundName}
              onChange={(e) => setRoundName(e.target.value)}
              placeholder={`e.g. Perfect Play ${sportName} — Round 1`}
              className="w-64 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              disabled={isLocked}
            />
          </label>
        </div>

        <div className="mt-4 rounded-md border border-border bg-surface-raised p-3">
          {!seasonId && <p className="text-sm text-muted">Sync the schedule above to get a season, then enter a round number.</p>}
          {seasonId && !canQuery && <p className="text-sm text-muted">Enter a round number to check for an existing selection.</p>}
          {canQuery && !selection && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted">Automatic selection not generated.</p>
              <button onClick={generate} disabled={generating} className="w-fit rounded-md bg-brand px-4 py-2 text-sm font-semibold text-background disabled:opacity-50">
                {generating ? "Generating…" : "Generate 8 random games"}
              </button>
            </div>
          )}

          {selection && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${isLocked ? "border-brand/30 bg-brand-soft text-brand" : "border-gold/30 text-gold"}`}>
                  Status: {isLocked ? "LOCKED" : "GENERATED"}
                </span>
                <span className="text-xs text-muted">Games selected: {games.length}</span>
                <span className="text-xs text-muted">Generated: {new Date(selection.generatedAt).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })} AEST</span>
                {selection.lockedAt && <span className="text-xs text-muted">Locked: {new Date(selection.lockedAt).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })} AEST</span>}
                <span className="text-xs text-muted" title="Cryptographically random seed — stored for audit, shown here only to admins">
                  Seed: {selection.seed.slice(0, 12)}…
                </span>
              </div>

              {countByDay && (
                // Informational only — gamesPerDay is a PREFERENCE, not a requirement,
                // so an uneven split (e.g. a real NBA Cup week) is never flagged as an
                // error here; it's still a perfectly valid, fully real 8-game round.
                <div className="flex flex-wrap gap-2 text-xs">
                  {Object.entries(countByDay).map(([day, count]) => (
                    <span key={day} className={`rounded-full border px-2.5 py-1 ${count === shapeConfig.gamesPerDay ? "border-brand/30 text-brand" : "border-border text-muted"}`}>
                      {day[0].toUpperCase() + day.slice(1)}: {count} (preferred {shapeConfig.gamesPerDay})
                    </span>
                  ))}
                </div>
              )}

              <ol className="flex flex-col gap-1.5">
                {games.map((g, i) => (
                  <li key={g.gameId} className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm">
                    <span className="text-foreground">
                      {i + 1}. {g.awayTeamName} @ {g.homeTeamName}
                      {g.dayLabel ? ` (${g.dayLabel[0].toUpperCase() + g.dayLabel.slice(1)})` : ""}
                    </span>
                    <span className="text-xs text-muted">{g.kickoff ? new Date(g.kickoff).toLocaleString("en-AU", { timeZone: "Australia/Sydney" }) : "TBC"} AEST</span>
                  </li>
                ))}
              </ol>

              {!isLocked && (
                <div className="flex gap-3">
                  <button onClick={regenerate} disabled={generating} className="rounded-md border border-border px-4 py-2 text-sm text-foreground disabled:opacity-50">
                    {generating ? "Regenerating…" : "Regenerate"}
                  </button>
                  <button onClick={lock} disabled={locking || !roundName} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-background disabled:opacity-50">
                    {locking ? "Locking…" : "Lock game selection"}
                  </button>
                </div>
              )}
              {isLocked && (
                <p className="text-sm text-brand">
                  This selection is locked and cannot be changed. The round is now live in Competitions, exactly like any other Perfect Play round.
                </p>
              )}
            </div>
          )}
        </div>

        {actionError && (
          <ul className="mt-3 list-disc pl-5 text-sm text-danger">
            {actionError.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
