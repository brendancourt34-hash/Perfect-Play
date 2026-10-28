"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PPMark } from "./pp-mark";
import { SPORTS } from "@/lib/sports/config";

const SPORT_LINKS = Object.values(SPORTS).map((s) => ({ href: `/${s.slug}`, label: s.name }));

export function Navbar() {
  // The home page builds its own sidebar/top-bar chrome (see src/app/page.tsx) matching
  // the approved desktop redesign, so the site-wide navbar would otherwise double up with
  // it — every other route keeps this navbar exactly as before.
  const pathname = usePathname();
  if (pathname === "/") return null;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-y-2 px-4 py-2 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <PPMark className="h-8 w-8 rounded-md" />
          <span className="whitespace-nowrap text-base font-semibold tracking-tight">
            Perfect <span className="text-brand">Play</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {SPORT_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/how-it-works"
            className="rounded-md px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface hover:text-foreground"
          >
            How it works
          </Link>
        </nav>

        <div className="flex flex-wrap items-center justify-end gap-1 sm:hidden">
          {SPORT_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-2 py-1.5 text-xs font-semibold text-muted hover:bg-surface hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/how-it-works"
            className="rounded-md px-2 py-1.5 text-xs font-semibold text-muted hover:bg-surface hover:text-foreground"
          >
            How it works
          </Link>
        </div>
      </div>
    </header>
  );
}
