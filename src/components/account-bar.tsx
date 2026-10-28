import { Bell, Wallet2 } from "lucide-react";
import { getCurrentUserForPage } from "@/lib/auth/require";
import { getBalance } from "@/lib/data/wallet";
import { formatAudCents } from "@/lib/utils/format";
import { AccountMenu } from "./account-menu";

function initialsFor(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return (parts[0]?.[0] ?? "").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

/**
 * Top-right cluster on the home page. Web has no login page yet, so there is never a real
 * session today — this renders honestly off getCurrentUserForPage() rather than faking a
 * signed-in state: a bare bell + "Log in" placeholder now, and the full
 * avatar/dropdown/live-balance treatment automatically once a real web login flow exists.
 */
export async function AccountBar() {
  const user = await getCurrentUserForPage();

  let resolvedBalanceCents: number | null = null;
  if (user) {
    const balanceResult = await getBalance(user.id);
    if (balanceResult.status === "ok") resolvedBalanceCents = balanceResult.data;
  }

  return (
    <div className="flex items-center gap-4">
      <button type="button" aria-label="Notifications" className="flex h-9 w-9 items-center justify-center text-muted transition-colors hover:text-foreground">
        <Bell className="h-5 w-5" strokeWidth={1.75} />
      </button>
      {user ? (
        <>
          <AccountMenu initials={initialsFor(user.name, user.email)} email={user.email} />
          <div className="flex items-center gap-2 rounded-full border border-brand/30 bg-brand-soft px-4 py-2 text-sm font-bold text-brand">
            <Wallet2 className="h-4 w-4" strokeWidth={1.75} />
            {resolvedBalanceCents !== null ? formatAudCents(resolvedBalanceCents) : "—"}
          </div>
        </>
      ) : (
        // No web login page exists yet — this is a plain status indicator, not a link to
        // a page that doesn't exist. Wire this up once a real web login flow is built.
        <span className="text-sm font-medium text-muted">Not logged in</span>
      )}
    </div>
  );
}
