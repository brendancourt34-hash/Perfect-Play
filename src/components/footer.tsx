"use client";

import { usePathname } from "next/navigation";
import { PPMark } from "./pp-mark";

export function Footer() {
  // The home page's sidebar carries its own Help & Support / Responsible Gambling /
  // Terms links (see src/app/page.tsx), matching the approved desktop redesign.
  const pathname = usePathname();
  if (pathname === "/") return null;

  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <PPMark className="h-4 w-4 rounded-sm" />
              Perfect <span className="text-brand">Play</span>
            </p>
            <p className="mt-1 max-w-md text-xs text-muted">
              Independent statistics and analysis for NRL, AFL, NBA and NFL. Not affiliated with
              the NRL, AFL, NBA, NFL, or any club.
            </p>
          </div>
          <p className="text-xs text-muted-2">
            Odds and statistics change — always check the official source before entering.
            18+ Play Responsibly.
          </p>
        </div>
      </div>
    </footer>
  );
}
