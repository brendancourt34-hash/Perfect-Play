import { apiForbidden, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/require";
import { isAuthorizedCronRequest } from "@/lib/auth/cron";
import { runRoundLifecycleNotificationChecks } from "@/lib/data/notifications";
import { logEvent } from "@/lib/monitoring/log";

/**
 * The scheduled-job boundary for round-lifecycle customer events (ENTRY_MARKET_OPEN,
 * TEAM_LISTS_AVAILABLE, ENTRY_CLOSING_SOON/NOW — Feature 3). Wired to Vercel Cron
 * (see vercel.json — this project is linked to Vercel, see .vercel/project.json) on a
 * once-per-minute schedule, which is what actually reaches the 10/5/1-minute closing
 * windows reliably. Never runs on every app open or from any customer-facing request path.
 *
 * Two independent ways to authorize a call, checked in this order:
 *  1. Vercel Cron's own bearer token (`Authorization: Bearer $CRON_SECRET`, sent
 *     automatically once CRON_SECRET is set in the project's environment — see
 *     src/lib/auth/cron.ts). This is the production path.
 *  2. A real admin session (requireAdmin) — kept so an admin can still trigger this
 *     manually (e.g. to catch up after an incident) without needing the cron secret.
 * Never open to an unauthenticated caller either way: with CRON_SECRET unset, path 1
 * always rejects (isAuthorizedCronRequest's closed-by-default rule), so the endpoint
 * falls through to requiring a real admin session.
 */
export async function POST(request: Request) {
  if (isAuthorizedCronRequest(request, process.env.CRON_SECRET)) {
    const result = await runRoundLifecycleNotificationChecks();
    if (result.status === "unavailable") {
      logEvent("customer_event_broadcast", { stage: "scheduled_tick", status: "failed", message: result.message }, "error");
      return apiUnavailable();
    }
    logEvent("customer_event_broadcast", { stage: "scheduled_tick", status: "ok", competitionsChecked: result.data.length });
    return apiOk({ competitionsChecked: result.data.length, results: result.data });
  }

  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const result = await runRoundLifecycleNotificationChecks();
  if (result.status === "unavailable") return apiUnavailable();
  return apiOk({ competitionsChecked: result.data.length, results: result.data });
}
