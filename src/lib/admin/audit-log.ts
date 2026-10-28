/**
 * Structured admin-action logging (Phase 18, extended Phase 23 to cover every mutating
 * admin route — competition lifecycle, sports-data sync, game/selection voiding, entry
 * packages, platform settings, withdrawals, terms publishing, and wallet adjustments). No
 * dedicated audit table was added — see docs/phase18-admin-dashboard.md: every mutation
 * logged here is also independently reconstructable from existing data (e.g.
 * competitions.status, wallet_transactions, terms_versions.status), so a structured
 * console line per action is a real, inspectable audit trail via whatever request logging
 * the hosting platform already captures, without a new table. Never logs secrets — only
 * IDs and outcomes.
 */
export function logAdminAction(action: string, adminUserId: number, resourceId: number, outcome: "ok" | "failed", detail?: string) {
  console.log(
    JSON.stringify({
      event: "admin_action",
      action,
      adminUserId,
      resourceId,
      outcome,
      detail,
      at: new Date().toISOString(),
    }),
  );
}
