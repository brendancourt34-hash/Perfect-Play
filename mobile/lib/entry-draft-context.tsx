import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { RoundDetail } from "./api";

interface EntryDraftContextValue {
  /** One player id per game — undefined/missing means that game isn't picked yet. */
  picks: Record<number, number | undefined>;
  setPick: (gameId: number, playerId: number) => void;
  clearGame: (gameId: number) => void;
  reset: () => void;
  isGameComplete: (gameId: number) => boolean;
  completeCount: (gameIds: number[]) => number;
  /** Cached round+games+players payload — set once by the picks screen, reused by
   *  review so it never needs to re-fetch the same round mid-flow. */
  roundDetail: RoundDetail | null;
  setRoundDetail: (detail: RoundDetail | null) => void;
}

const EntryDraftContext = createContext<EntryDraftContextValue | null>(null);

/**
 * Holds the user's in-progress picks (one player per game — "pick the Perfect Round")
 * while they move between the pick screen and the review screen for one round's entry.
 * Purely local UI state — it's never treated as authoritative and is discarded once the
 * entry is submitted (or the flow is abandoned); the server independently re-validates
 * every selection on submit.
 */
export function EntryDraftProvider({ children }: { children: ReactNode }) {
  const [picks, setPicks] = useState<Record<number, number | undefined>>({});
  const [roundDetail, setRoundDetail] = useState<RoundDetail | null>(null);

  const setPick = useCallback((gameId: number, playerId: number) => {
    setPicks((prev) => ({ ...prev, [gameId]: playerId }));
  }, []);

  const clearGame = useCallback((gameId: number) => {
    setPicks((prev) => {
      const next = { ...prev };
      delete next[gameId];
      return next;
    });
  }, []);

  const reset = useCallback(() => setPicks({}), []);

  const isGameComplete = useCallback((gameId: number) => picks[gameId] != null, [picks]);

  const completeCount = useCallback(
    (gameIds: number[]) => gameIds.filter((id) => isGameComplete(id)).length,
    [isGameComplete],
  );

  const value = useMemo(
    () => ({ picks, setPick, clearGame, reset, isGameComplete, completeCount, roundDetail, setRoundDetail }),
    [picks, setPick, clearGame, reset, isGameComplete, completeCount, roundDetail],
  );

  return <EntryDraftContext.Provider value={value}>{children}</EntryDraftContext.Provider>;
}

export function useEntryDraft(): EntryDraftContextValue {
  const ctx = useContext(EntryDraftContext);
  if (!ctx) throw new Error("useEntryDraft must be used within EntryDraftProvider");
  return ctx;
}
