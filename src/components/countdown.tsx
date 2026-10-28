"use client";

import { useEffect, useState } from "react";

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * Live "locks in HH:MM:SS" countdown for the featured competition card — mirrors
 * mobile/components/Countdown.tsx exactly (same segment/label shape). Purely
 * presentational: ticks locally from `target`, never treated as authoritative for
 * cutoff enforcement, which stays entirely server-side.
 */
export function Countdown({ target }: { target: Date }) {
  // Lazy initializer runs at render time (not inside an effect) — the interval below only
  // subscribes to further ticks. The very first server-rendered digits and the client's
  // first paint can differ by a second or two (expected for any live clock); the
  // suppressHydrationWarning below is scoped to just those digits.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remainingMs = Math.max(0, target.getTime() - now);
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return (
    <div className="flex flex-col items-center rounded-xl border border-border bg-surface-raised px-4 py-3">
      <p suppressHydrationWarning className="text-[10px] font-bold uppercase tracking-widest text-muted-2">
        {remainingMs === 0 ? "Locked" : "Locks in"}
      </p>
      {remainingMs > 0 && (
        <div className="mt-1 flex items-end gap-1">
          <Segment value={pad(hours)} unit="HRS" />
          <span className="pb-2 text-base font-extrabold text-muted-2">:</span>
          <Segment value={pad(minutes)} unit="MINS" />
          <span className="pb-2 text-base font-extrabold text-muted-2">:</span>
          <Segment value={pad(seconds)} unit="SECS" />
        </div>
      )}
    </div>
  );
}

function Segment({ value, unit }: { value: string; unit: string }) {
  return (
    <div className="flex flex-col items-center">
      <span suppressHydrationWarning className="font-mono text-xl font-extrabold tabular-nums text-foreground">
        {value}
      </span>
      <span className="text-[9px] font-bold text-muted-2">{unit}</span>
    </div>
  );
}
