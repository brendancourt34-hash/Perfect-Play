import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAdminForPage } from "@/lib/auth/require";
import { PPMark } from "@/components/pp-mark";

/**
 * Server-side gate for every /admin page except /admin/login. Not authenticated at all ->
 * redirect to login (there's nothing to show). Authenticated but not an admin -> render an
 * explicit Forbidden message rather than silently redirecting, so a non-admin customer
 * account gets unambiguous feedback. The equivalent machine-readable 401/403 responses are
 * what /api/admin/* actually returns (see src/lib/auth/require.ts requireAdmin) — this
 * page-level check exists so the HTML itself never renders admin data for the wrong user;
 * it is not the security boundary by itself.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAdminForPage();

  if (auth.status === "unauthenticated") redirect("/admin/login");

  if (auth.status === "forbidden") {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-lg font-bold text-foreground">403 — Forbidden</h1>
        <p className="mt-2 text-sm text-muted">This account doesn&apos;t have admin access.</p>
      </div>
    );
  }

  if (auth.status === "unavailable") {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-lg font-bold text-foreground">Temporarily unavailable</h1>
        <p className="mt-2 text-sm text-muted">{auth.message}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <nav className="mb-8 flex items-center gap-6 border-b border-border pb-4">
        <span className="flex items-center gap-1.5 text-sm font-bold text-foreground">
          <PPMark className="h-4 w-4 rounded-sm" />
          PERFECT PLAY ADMIN
        </span>
        <Link href="/admin" className="text-sm text-muted hover:text-foreground">
          Dashboard
        </Link>
        <Link href="/admin/competitions" className="text-sm text-muted hover:text-foreground">
          Competitions
        </Link>
        <Link href="/admin/nrl" className="text-sm text-muted hover:text-foreground">
          NRL Rounds
        </Link>
        <Link href="/admin/afl" className="text-sm text-muted hover:text-foreground">
          AFL Rounds
        </Link>
        <Link href="/admin/nba" className="text-sm text-muted hover:text-foreground">
          NBA Rounds
        </Link>
        <Link href="/admin/nfl" className="text-sm text-muted hover:text-foreground">
          NFL Rounds
        </Link>
        <Link href="/admin/simulation" className="text-sm text-muted hover:text-foreground">
          Simulation
        </Link>
        <Link href="/admin/settings" className="text-sm text-muted hover:text-foreground">
          Settings
        </Link>
        <Link href="/admin/withdrawals" className="text-sm text-muted hover:text-foreground">
          Withdrawals
        </Link>
        <Link href="/admin/terms" className="text-sm text-muted hover:text-foreground">
          Terms
        </Link>
        <span className="ml-auto text-xs text-muted">{auth.user.email}</span>
      </nav>
      {children}
    </div>
  );
}
