"use client";

import { useState } from "react";
import { formatAudCents } from "@/lib/utils/format";

const PRESETS: { label: string; favoriteWeightsPct: number[] }[] = [
  { label: "100% pick the #1 favourite", favoriteWeightsPct: [100] },
  { label: "90 / 8 / 2", favoriteWeightsPct: [90, 8, 2] },
  { label: "80 / 15 / 5", favoriteWeightsPct: [80, 15, 5] },
  { label: "70 / 20 / 10", favoriteWeightsPct: [70, 20, 10] },
];

/** Illustrative modeling defaults ONLY — never real statistics, never shown to a customer. Length always matches favoriteWeightsPct.length + 1 (the trailing "other" bucket). */
const DEFAULT_SUCCESS_PROBABILITIES: Record<number, number[]> = {
  1: [0.4],
  3: [0.4, 0.28, 0.18, 0.1],
};

interface SimulationResult {
  singleGameSuccessProbability: number;
  analytical: {
    expectedPerfectRate: number;
    expectedWinnerCount: number;
    probabilityZeroPerfect: number;
    expectedPayoutPerPerfectEntryCents: number | null;
  };
  simulated: {
    simulatedPerfectRatePct: number;
    simulatedExpectedWinnerCount: number;
    simulatedProbabilityZeroPerfectPct: number;
    simulatedAveragePayoutPerPerfectEntryCents: number | null;
    correctCountDistribution: { correctCount: number; percentage: number }[];
  };
}

export function SimulationTool() {
  const [gamesCount, setGamesCount] = useState(8);
  const [customerCount, setCustomerCount] = useState(5000);
  const [numberOfSimulations, setNumberOfSimulations] = useState(100);
  const [presetIndex, setPresetIndex] = useState(3);
  const [assumedPrizePoolCents, setAssumedPrizePoolCents] = useState(250_000_00);
  const [seed, setSeed] = useState("admin-simulation-1");
  const [rankProbabilities, setRankProbabilities] = useState<number[]>(DEFAULT_SUCCESS_PROBABILITIES[3]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);

  function applyPreset(index: number) {
    setPresetIndex(index);
    const rankCount = PRESETS[index].favoriteWeightsPct.length;
    setRankProbabilities(DEFAULT_SUCCESS_PROBABILITIES[rankCount] ?? Array(rankCount + 1).fill(0.2));
  }

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/admin/simulation", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gamesCount,
        customerCount,
        numberOfSimulations,
        favoriteWeightsPct: PRESETS[presetIndex].favoriteWeightsPct,
        rankSuccessProbabilities: rankProbabilities,
        assumedPrizePoolCents,
        seed,
      }),
    });
    const body = await res.json();
    setLoading(false);
    if (!body.ok) {
      setError(body.errors?.join(" ") ?? body.message ?? "Simulation failed.");
      return;
    }
    setResult(body.data.result);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Games in round">
          <input type="number" min={1} value={gamesCount} onChange={(e) => setGamesCount(Number(e.target.value))} className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground" />
        </Field>
        <Field label="Simulated customers">
          <input type="number" min={1} value={customerCount} onChange={(e) => setCustomerCount(Number(e.target.value))} className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground" />
        </Field>
        <Field label="Number of simulations">
          <input type="number" min={1} max={500} value={numberOfSimulations} onChange={(e) => setNumberOfSimulations(Number(e.target.value))} className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground" />
        </Field>
        <Field label="Assumed prize pool">
          <input
            type="number"
            min={0}
            value={assumedPrizePoolCents / 100}
            onChange={(e) => setAssumedPrizePoolCents(Math.round(Number(e.target.value) * 100))}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          />
        </Field>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Customer selection model</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => applyPreset(i)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                presetIndex === i ? "border-brand bg-brand-soft text-brand-text" : "border-border bg-surface text-muted"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          Assumed TRUE success probability per rank (modeling input only — not real statistics)
        </p>
        <div className="flex flex-wrap gap-2">
          {rankProbabilities.map((p, i) => (
            <label key={i} className="flex items-center gap-1 text-xs text-muted">
              {i < PRESETS[presetIndex].favoriteWeightsPct.length ? `Rank ${i + 1}` : "Other"}
              <input
                type="number"
                min={0}
                max={1}
                step="0.01"
                value={p}
                onChange={(e) => {
                  const next = [...rankProbabilities];
                  next[i] = Number(e.target.value);
                  setRankProbabilities(next);
                }}
                className="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
              />
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <input
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          placeholder="Seed (reproducibility)"
        />
        <button onClick={run} disabled={loading} className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          {loading ? "Running…" : "Run simulation"}
        </button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {result && (
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Analytical PERFECT rate" value={`${(result.analytical.expectedPerfectRate * 100).toFixed(4)}%`} />
            <Stat label="Simulated PERFECT rate" value={`${result.simulated.simulatedPerfectRatePct}%`} tone="brand" />
            <Stat label="Expected winners" value={result.analytical.expectedWinnerCount.toFixed(2)} />
            <Stat label="Simulated avg winners" value={result.simulated.simulatedExpectedWinnerCount.toFixed(2)} />
            <Stat label="P(zero PERFECT) — analytical" value={`${(result.analytical.probabilityZeroPerfect * 100).toFixed(2)}%`} />
            <Stat label="P(zero PERFECT) — simulated" value={`${result.simulated.simulatedProbabilityZeroPerfectPct}%`} />
            <Stat
              label="Payout / PERFECT entry (analytical)"
              value={result.analytical.expectedPayoutPerPerfectEntryCents !== null ? formatAudCents(Math.round(result.analytical.expectedPayoutPerPerfectEntryCents)) : "—"}
            />
            <Stat
              label="Payout / PERFECT entry (simulated)"
              value={result.simulated.simulatedAveragePayoutPerPerfectEntryCents !== null ? formatAudCents(result.simulated.simulatedAveragePayoutPerPerfectEntryCents) : "—"}
              tone="brand"
            />
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Distribution of correct selections (simulated)</p>
            <div className="flex flex-wrap gap-2">
              {result.simulated.correctCountDistribution.map((b) => (
                <span key={b.correctCount} className="rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-xs text-muted">
                  {b.correctCount}/{gamesCount}: <span className="font-semibold text-foreground">{b.percentage}%</span>
                </span>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-2">
            Internal product/statistics modeling only. This tool never provides betting advice, odds, or a recommended pick, and is never shown
            to customers.
          </p>
        </div>
      )}

    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "brand" }) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-sm font-bold ${tone === "brand" ? "text-brand-text" : "text-foreground"}`}>{value}</p>
    </div>
  );
}
