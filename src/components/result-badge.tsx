import type { EntryResult, GameSelectionResult, SelectionResult } from "@/lib/perfect2/types";
import type { GameStatus } from "@/db/schema";
import type { EffectiveCompetitionState } from "@/lib/competitions/lifecycle";
import { cn } from "@/lib/utils/format";

const SELECTION_STYLES: Record<SelectionResult, string> = {
  pending: "bg-surface-raised text-muted border-border",
  correct: "bg-brand-soft text-brand-text border-brand/30",
  incorrect: "bg-danger-soft text-danger border-danger/30",
  void: "bg-surface-raised text-muted border-border",
};

const SELECTION_LABEL: Record<SelectionResult, string> = {
  pending: "Pending",
  correct: "Correct",
  incorrect: "Incorrect",
  void: "Voided",
};

/** Shows a single player pick's outcome — pending/correct/incorrect. No points involved. */
export function SelectionOutcomeBadge({ result, className }: { result: SelectionResult; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold tracking-wide",
        SELECTION_STYLES[result],
        className,
      )}
    >
      {SELECTION_LABEL[result]}
    </span>
  );
}

const PERFECT_STYLES: Record<GameSelectionResult | EntryResult, string> = {
  pending: "bg-surface-raised text-muted border-border",
  perfect: "border-gold/40 bg-gold-soft text-gold",
  not_perfect: "bg-danger-soft text-danger border-danger/30",
};

const PERFECT_LABEL: Record<GameSelectionResult | EntryResult, string> = {
  pending: "Pending",
  perfect: "Perfect",
  not_perfect: "Not Perfect",
};

/** Shows a game's or an entry's overall outcome — pending/perfect/not_perfect. No points, no ranking. */
export function PerfectResultBadge({
  result,
  className,
}: {
  result: GameSelectionResult | EntryResult;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold",
        PERFECT_STYLES[result],
        className,
      )}
    >
      {PERFECT_LABEL[result]}
    </span>
  );
}

const GAME_STATUS_LABEL: Record<GameStatus, string> = {
  scheduled: "Upcoming",
  live: "Live",
  final: "Final",
  postponed: "Postponed",
  cancelled: "Cancelled",
};

/** Shows a game's real-world status (scheduled/live/final) — unrelated to any pick outcome. */
export function GameStatusChip({ status, className }: { status: GameStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold tracking-wide",
        status === "live"
          ? "border-brand/30 bg-brand-soft text-brand-text"
          : "border-border bg-surface-raised text-muted",
        className,
      )}
    >
      {GAME_STATUS_LABEL[status]}
    </span>
  );
}

const COMPETITION_STATE_STYLES: Record<EffectiveCompetitionState, string> = {
  not_yet_open: "border-border bg-surface-raised text-muted",
  open: "border-brand/30 bg-brand-soft text-brand-text",
  closed: "border-gold/40 bg-gold-soft text-gold",
  settled: "border-border bg-surface-raised text-muted",
};

const COMPETITION_STATE_LABEL: Record<EffectiveCompetitionState, string> = {
  not_yet_open: "Opens soon",
  open: "Open for entries",
  closed: "Competition closed",
  settled: "Settled",
};

/** Shows the competition's current effective state (see src/lib/competitions/lifecycle.ts). */
export function CompetitionStateBadge({ state, className }: { state: EffectiveCompetitionState; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold",
        COMPETITION_STATE_STYLES[state],
        className,
      )}
    >
      {COMPETITION_STATE_LABEL[state]}
    </span>
  );
}
