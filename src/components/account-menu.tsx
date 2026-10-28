"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, LogOut } from "lucide-react";

/** Small avatar + dropdown for the home page's account bar — logs out via the real, existing /api/auth/logout route (the same one the mobile app uses). */
export function AccountMenu({ initials, email }: { initials: string; email: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2 text-sm text-foreground transition-colors hover:bg-surface-raised"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-raised text-xs font-bold">{initials}</span>
        <ChevronDown className="h-4 w-4 text-muted" strokeWidth={2} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-border bg-surface p-2 shadow-lg">
          <p className="truncate px-2 py-1.5 text-xs text-muted">{email}</p>
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-surface-raised"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.75} />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
