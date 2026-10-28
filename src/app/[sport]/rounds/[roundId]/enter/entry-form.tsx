"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { submitEntry } from "./actions";
import { formatAudCents, formatAuDateTime } from "@/lib/utils/format";

export interface EntryFormPlayer {
  id: number;
  name: string;
  position: string;
  teamId: number;
}

export interface EntryFormGame {
  gameId: number;
  homeTeamName: string;
  awayTeamName: string;
  locked: boolean;
  players: EntryFormPlayer[];
}

interface EntryFormProps {
  sportSlug: string;
  sportName: string;
  roundId: number;
  roundLabel: string;
  selectionLabel: string;
  /** Short target tag, e.g. "1+ TRY" / "25+ POINTS" — shown next to the selection label so the correctness rule is never ambiguous. */
  selectionTarget: string;
  entryFeeCents: number;
  closesAt: Date | null;
  games: EntryFormGame[];
}

type Picks = Record<number, string>;
type Step = "picking" | "review" | "submitted";

export function EntryForm({
  sportSlug,
  sportName,
  roundId,
  roundLabel,
  selectionLabel,
  selectionTarget,
  entryFeeCents,
  closesAt,
  games,
}: EntryFormProps) {
  const [picks, setPicks] = useState<Picks>({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<Step>("picking");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<{ entryId: number } | null>(null);

  const openGames = games.filter((g) => !g.locked);
  const lockedGames = games.filter((g) => g.locked);
  const completeCount = openGames.filter((g) => picks[g.gameId]).length;

  const playerName = useMemo(() => {
    const byId = new Map<number, string>();
    for (const game of games) for (const p of game.players) byId.set(p.id, p.name);
    return (id: string) => byId.get(Number(id)) ?? "Unknown player";
  }, [games]);

  function setPick(gameId: number, value: string) {
    setPicks((prev) => ({ ...prev, [gameId]: value }));
  }

  function goToReview(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);

    const formErrors: string[] = [];
    for (const game of openGames) {
      if (!picks[game.gameId]) {
        formErrors.push(`Pick a ${selectionLabel.toLowerCase()} for ${game.homeTeamName} vs ${game.awayTeamName}.`);
      }
    }
    if (lockedGames.length > 0) {
      formErrors.push(
        `${lockedGames.length} game${lockedGames.length === 1 ? " has" : "s have"} already started and can't be entered this round.`,
      );
    }
    if (!name.trim() || !email.trim()) {
      formErrors.push("Enter your name and email to continue.");
    }
    if (formErrors.length > 0) {
      setErrors(formErrors);
      return;
    }
    setStep("review");
  }

  async function confirmSubmit() {
    setSubmitting(true);
    setErrors([]);
    try {
      const response = await submitEntry({
        sportSlug,
        roundId,
        userName: name,
        userEmail: email,
        selections: openGames.map((game) => ({
          gameId: game.gameId,
          playerIds: [Number(picks[game.gameId])],
        })),
      });

      if (response.status === "ok") {
        setResult({ entryId: response.entryId });
        setStep("submitted");
      } else if (response.status === "invalid") {
        setErrors(response.errors);
        setStep("picking");
      } else {
        setErrors([response.message]);
        setStep("picking");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "submitted" && result) {
    return (
      <div className="rounded-xl border border-brand/30 bg-brand-soft p-6">
        <p className="text-sm font-semibold text-foreground">Entry submitted — your PERFECT ROUND is locked in</p>
        <dl className="mt-4 space-y-1 text-sm text-muted">
          <div className="flex justify-between">
            <dt>Competition</dt>
            <dd className="text-foreground">
              Perfect Play {sportName} — {roundLabel}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>Selections submitted</dt>
            <dd className="text-foreground">{openGames.length} games</dd>
          </div>
          <div className="flex justify-between">
            <dt>Entry fee</dt>
            <dd className="text-foreground">{formatAudCents(entryFeeCents)}</dd>
          </div>
          {closesAt && (
            <div className="flex justify-between">
              <dt>Selections lock</dt>
              <dd className="text-foreground">{formatAuDateTime(closesAt)}</dd>
            </div>
          )}
        </dl>
        <p className="mt-4 rounded-lg border border-gold/40 bg-gold-soft px-3 py-2 text-xs text-gold">
          Payment has not been processed — this entry is not yet confirmed for the prize pool. Payment collection is
          not connected yet.
        </p>
        <p className="mt-3 text-xs text-muted-2">
          Get every pick right to go PERFECT. GO PERFECT. TAKE THE ENTIRE POOL — if more than one entry goes
          PERFECT, the pool is split evenly. Your picks are locked in and cannot be changed once the round closes
          (entry #{result.entryId}).
        </p>
        <Link
          href={`/${sportSlug}/entries/${result.entryId}`}
          className="mt-4 inline-block text-xs font-medium text-brand-text hover:underline"
        >
          View my entry &rarr;
        </Link>
      </div>
    );
  }

  if (step === "review") {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
          <p className="text-sm font-semibold text-foreground">
            READY TO GO PERFECT? — Perfect Play {sportName}, {roundLabel}
          </p>
          <p className="mt-1 text-xs text-muted-2">
            Check every selection before submitting. Get every pick right to go PERFECT — no points, just correct or
            incorrect on every game.
          </p>
          <div className="mt-4 space-y-3">
            {openGames.map((game) => {
              const pick = picks[game.gameId];
              return (
                <div key={game.gameId} className="rounded-lg border border-border bg-surface-raised p-3">
                  <p className="text-xs font-semibold text-muted-2">
                    {game.homeTeamName} vs {game.awayTeamName}
                  </p>
                  <p className="mt-1 text-sm text-foreground">{playerName(pick)}</p>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex justify-between border-t border-border pt-4 text-sm">
            <span className="text-muted-2">Entry fee</span>
            <span className="font-semibold text-foreground">{formatAudCents(entryFeeCents)}</span>
          </div>
        </div>

        {errors.length > 0 && (
          <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
            <ul className="list-inside list-disc space-y-1">
              {errors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setStep("picking")}
            className="rounded-lg border border-border bg-surface px-5 py-3 text-sm font-semibold text-foreground transition-colors hover:border-brand/30"
          >
            Back to edit
          </button>
          <button
            type="button"
            onClick={confirmSubmit}
            disabled={submitting}
            className="flex-1 rounded-lg bg-brand px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:opacity-50"
          >
            {submitting ? "Submitting…" : `Confirm entry — ${formatAudCents(entryFeeCents)}`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={goToReview} className="space-y-6">
      <div className="rounded-lg border border-border bg-surface-raised px-4 py-3">
        <p className="text-sm font-semibold text-foreground">Build your PERFECT ROUND</p>
        <p className="mt-1 text-xs text-muted-2">
          Make your pick for every game. Get every pick right to go PERFECT. {completeCount}/{openGames.length} games
          complete.
        </p>
      </div>

      {lockedGames.length > 0 && (
        <div className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-xs text-muted">
          {lockedGames.length} game{lockedGames.length === 1 ? " has" : "s have"} already started and{" "}
          {lockedGames.length === 1 ? "is" : "are"} locked out of this entry: {lockedGames.map((g) => `${g.homeTeamName} vs ${g.awayTeamName}`).join(", ")}.
        </div>
      )}

      <div className="space-y-4">
        {openGames.map((game) => (
          <div key={game.gameId} className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <p className="text-sm font-semibold text-foreground">
              {game.homeTeamName} vs {game.awayTeamName}
            </p>
            {game.players.length === 0 ? (
              <p className="mt-2 text-xs text-muted-2">Team lists aren&apos;t published for this game yet.</p>
            ) : (
              <label className="mt-3 block">
                <span className="text-xs font-medium text-muted-2">
                  {selectionLabel} <span className="text-brand-text">· {selectionTarget}</span>
                </span>
                <select
                  required
                  value={picks[game.gameId] ?? ""}
                  onChange={(e) => setPick(game.gameId, e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Select a player</option>
                  {game.players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.position})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-muted-2">Your name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-foreground"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted-2">Email</span>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-foreground"
          />
        </label>
      </div>

      {errors.length > 0 && (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <ul className="list-inside list-disc space-y-1">
            {errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="submit"
        disabled={openGames.length === 0}
        className="w-full rounded-lg bg-brand px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-strong disabled:opacity-50"
      >
        Review entry — {formatAudCents(entryFeeCents)}
      </button>
    </form>
  );
}
