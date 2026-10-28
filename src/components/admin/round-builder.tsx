"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getRoundShapeConfig, validateRoundShape } from "@/lib/perfect2/round-shape";
import { getSelectionConfig } from "@/lib/perfect2/registry";

interface CandidateGame {
  gameId: number;
  homeTeamName: string;
  awayTeamName: string;
  kickoff: string | null;
  status: string;
}

interface RoundBuilderProps {
  sportCode: string;
  sportName: string;
  /** NBA syncs by a real calendar date range (no upstream "round" concept); NRL/AFL sync one provider round at a time. */
  syncMode: "date-range" | "provider-round";
  /** Only NBA curates into fixed Thursday/Friday/Saturday/Sunday day slots. */
  daySlots?: readonly string[];
}

/**
 * Generic admin round-curation workflow (Phase 22, generalized beyond NBA): sync real
 * games for a window from the sport's real data provider -> browse the real candidates it
 * returned -> select however many belong in this week's Perfect Play round (NBA: exactly 8,
 * 2 per day; NRL/AFL: any number — 8 in a normal week, 6 during a State of Origin/
 * bye-heavy week, or any other count — see src/lib/perfect2/round-shape.ts) -> create the
 * round. Every game shown here is real, already-synced data; this component never
 * invents a game or a team.
 */
export function RoundBuilder({ sportCode, sportName, syncMode, daySlots }: RoundBuilderProps) {
  const router = useRouter();

  // --- sync form fields (shape depends on syncMode) ---
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [seasonExternalId, setSeasonExternalId] = useState("");
  const [roundExternalId, setRoundExternalId] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<number | null>(null);

  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidates, setCandidates] = useState<CandidateGame[] | null>(null);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Record<number, string | null>>({});

  const [roundNumber, setRoundNumber] = useState("");
  const [roundName, setRoundName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string[] | null>(null);
  const [createdRoundId, setCreatedRoundId] = useState<number | null>(null);

  const assignmentList = useMemo(
    () => Object.entries(assignments).map(([gameId, slotLabel]) => ({ gameId: Number(gameId), slotLabel })),
    [assignments],
  );
  const shapeCheck = useMemo(() => validateRoundShape(sportCode, assignmentList), [sportCode, assignmentList]);
  const shapeConfig = useMemo(() => getRoundShapeConfig(sportCode), [sportCode]);
  const selectionConfig = useMemo(() => getSelectionConfig(sportCode), [sportCode]);
  // Omit the leading count when the label already starts with its own number (e.g. NBA's
  // "25+ Points") — "1 25+ points per game" reads as a double number, "25+ points per
  // game" doesn't. Every other label (a plain noun phrase like "Try Scorer") keeps the
  // explicit count, e.g. "1 try scorer per game".
  const labelStartsWithDigit = /^\d/.test(selectionConfig.selectionLabel);
  const selectionPhrase = labelStartsWithDigit
    ? selectionConfig.selectionLabel.toLowerCase()
    : `${selectionConfig.selectionsPerGame} ${selectionConfig.selectionLabel.toLowerCase()}${selectionConfig.selectionsPerGame === 1 ? "" : "s"}`;
  const ruleSummary = `${shapeConfig.gamesPerRound ?? shapeConfig.recommendedGamesPerRound ?? "any number of"} games • ${selectionPhrase} per game`;
  const countByDay = useMemo(() => {
    if (!daySlots) return null;
    const counts: Record<string, number> = {};
    for (const d of daySlots) counts[d] = 0;
    for (const a of assignmentList) if (a.slotLabel) counts[a.slotLabel] = (counts[a.slotLabel] ?? 0) + 1;
    return counts;
  }, [assignmentList, daySlots]);

  async function syncSchedule() {
    setSyncing(true);
    setSyncError(null);
    setSyncMessage(null);
    const endpoint = syncMode === "date-range" ? "/api/admin/nba/sync-schedule" : "/api/admin/rounds/sync-provider-round";
    const payload =
      syncMode === "date-range"
        ? { startDate, endDate }
        : { sportCode, sportName, seasonExternalId, roundExternalId };
    const res = await fetch(endpoint, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await res.json();
    setSyncing(false);
    if (!body.ok) {
      setSyncError(body.errors?.[0] ?? body.message ?? "Sync failed.");
      return;
    }
    setSeasonId(body.data.seasonId);
    const voided = body.data.games.selectionsVoided as number;
    setSyncMessage(
      `Synced ${body.data.games.inserted + body.data.games.updated} real games from the live ${sportName} schedule.` +
        (voided > 0 ? ` ${voided} selection${voided === 1 ? "" : "s"} voided — a game the provider now reports cancelled.` : ""),
    );
    if (syncMode === "provider-round") await loadCandidates();
  }

  async function loadCandidates() {
    if (!startDate || !endDate) return;
    setLoadingCandidates(true);
    setCandidatesError(null);
    const res = await fetch(`/api/admin/rounds/candidates?sportCode=${sportCode}&startDate=${startDate}&endDate=${endDate}`, { credentials: "include" });
    const body = await res.json();
    setLoadingCandidates(false);
    if (!body.ok) {
      setCandidatesError(body.message ?? "Failed to load candidates.");
      return;
    }
    setCandidates(body.data.candidates);
  }

  async function createRound() {
    if (!seasonId || !roundNumber || !roundName) {
      setCreateError(["Season, round number, and round name are all required (sync the schedule first)."]);
      return;
    }
    setCreating(true);
    setCreateError(null);
    const res = await fetch("/api/admin/rounds/create", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sportCode, seasonId, roundNumber: Number(roundNumber), name: roundName, startDate, endDate, assignments: assignmentList }),
    });
    const body = await res.json();
    setCreating(false);
    if (!body.ok) {
      setCreateError(body.errors ?? [body.message ?? "Round creation failed."]);
      return;
    }
    setCreatedRoundId(body.data.roundId);
    router.push(`/admin/competitions`);
  }

  return (
    <div className="flex flex-col gap-6">
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
            <label className="flex flex-col gap-1 text-xs text-muted">
              Candidate window start (for browsing below)
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Candidate window end
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" />
            </label>
          </div>
        )}
        <div className="mt-3 flex gap-3">
          <button
            onClick={syncSchedule}
            disabled={syncing || (syncMode === "date-range" ? !startDate || !endDate : !seasonExternalId || !roundExternalId)}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-background disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "Sync real schedule"}
          </button>
          <button onClick={loadCandidates} disabled={loadingCandidates || !startDate || !endDate} className="rounded-md border border-border px-4 py-2 text-sm text-foreground disabled:opacity-50">
            {loadingCandidates ? "Loading…" : "Reload candidates"}
          </button>
        </div>
        {syncMessage && <p className="mt-2 text-sm text-brand">{syncMessage}</p>}
        {syncError && <p className="mt-2 text-sm text-danger">{syncError}</p>}
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">
          2.{" "}
          {shapeConfig.gamesPerRound !== null
            ? `Assign exactly ${shapeConfig.gamesPerRound} games${shapeConfig.gamesPerDay ? ` — ${shapeConfig.gamesPerDay} per day` : ""}`
            : `Select which games belong in this round${shapeConfig.recommendedGamesPerRound ? ` (normally ${shapeConfig.recommendedGamesPerRound}, but any number is allowed — e.g. fewer during State of Origin or a bye-heavy week)` : ""}`}
        </h2>
        {candidatesError && <p className="text-sm text-danger">{candidatesError}</p>}
        {!candidates && !candidatesError && <p className="text-sm text-muted">Sync or load candidates for the window above.</p>}
        {candidates && candidates.length === 0 && <p className="text-sm text-muted">No real games found in that window yet — try syncing.</p>}
        {candidates && candidates.length > 0 && (
          <div className="flex flex-col gap-2">
            {candidates.map((g) => (
              <div key={g.gameId} className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-raised p-3 text-sm">
                <div>
                  <p className="font-medium text-foreground">
                    {g.awayTeamName} @ {g.homeTeamName}
                  </p>
                  <p className="text-xs text-muted">{g.kickoff ? new Date(g.kickoff).toLocaleString("en-AU", { timeZone: "Australia/Sydney" }) : "TBC"} AEST</p>
                </div>
                {daySlots ? (
                  <select
                    value={assignments[g.gameId] ?? ""}
                    onChange={(e) =>
                      setAssignments((prev) => {
                        if (!e.target.value) {
                          const { [g.gameId]: _removed, ...rest } = prev;
                          return rest;
                        }
                        return { ...prev, [g.gameId]: e.target.value };
                      })
                    }
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                  >
                    <option value="">Not selected</option>
                    {daySlots.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot[0].toUpperCase() + slot.slice(1)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <label className="flex items-center gap-2 text-xs text-foreground">
                    <input
                      type="checkbox"
                      checked={g.gameId in assignments}
                      onChange={(e) =>
                        setAssignments((prev) => {
                          if (!e.target.checked) {
                            const { [g.gameId]: _removed, ...rest } = prev;
                            return rest;
                          }
                          return { ...prev, [g.gameId]: null };
                        })
                      }
                    />
                    Include
                  </label>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-3 text-xs">
          {countByDay &&
            Object.entries(countByDay).map(([day, count]) => (
              <span key={day} className={`rounded-full border px-2.5 py-1 ${count === 2 ? "border-brand/30 text-brand" : "border-border text-muted"}`}>
                {day[0].toUpperCase() + day.slice(1)}: {count}/2
              </span>
            ))}
          <span className="rounded-full border border-border px-2.5 py-1 text-muted">Total selected: {assignmentList.length}</span>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">3. Create the round</h2>
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
              placeholder={`e.g. ${sportName} Perfect Play — Round 1`}
              className="w-64 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          <button onClick={createRound} disabled={creating || !shapeCheck.valid || !seasonId || assignmentList.length === 0} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-background disabled:opacity-50">
            {creating ? "Creating…" : `Create ${sportName} round`}
          </button>
        </div>
        {!shapeCheck.valid && assignmentList.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-sm text-gold">
            {shapeCheck.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {createError && (
          <ul className="mt-2 list-disc pl-5 text-sm text-danger">
            {createError.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {createdRoundId && <p className="mt-2 text-sm text-brand">Round #{createdRoundId} created.</p>}
      </section>
    </div>
  );
}
