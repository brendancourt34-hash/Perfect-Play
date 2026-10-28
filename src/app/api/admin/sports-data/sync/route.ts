import { requireAdmin } from "@/lib/auth/require";
import { getSportByCode } from "@/lib/data/sports";
import { getSportsDataProvider } from "@/lib/sports-data/registry";
import { runFullSync } from "@/lib/sports-data/orchestrate";
import { logAdminAction } from "@/lib/admin/audit-log";
import { apiError, apiForbidden, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

interface SyncRequestBody {
  sportCode?: string;
  seasonExternalId?: string;
  roundExternalId?: string;
}

/**
 * Manual sports-data sync trigger for the admin dashboard (Phase 21). This is NOT a fake
 * "Champion Data sync" button that implies a live integration exists — it runs the real
 * sync pipeline (src/lib/sports-data/orchestrate.ts) against whichever provider
 * getSportsDataProvider() (src/lib/sports-data/registry.ts) actually resolves to:
 *  - unconfigured (the default): fails with a clear 503, no data touched.
 *  - "champion-data": fails immediately (no real credentials exist yet) — never fabricates a connection.
 *  - "mock": genuinely syncs the labelled Phase 21 lifecycle fixture into the real dev
 *    database — an explicit, honest dev/test action, never silently substituted for real data.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  let body: SyncRequestBody;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Malformed request body.");
  }
  const { sportCode, seasonExternalId, roundExternalId } = body;
  if (!sportCode || !seasonExternalId || !roundExternalId) {
    return apiError(400, "sportCode, seasonExternalId, and roundExternalId are all required.");
  }

  const sportResult = await getSportByCode(sportCode);
  if (sportResult.status === "unavailable") return apiUnavailable();
  if (!sportResult.data) return apiNotFound("Sport");

  let provider;
  try {
    provider = getSportsDataProvider();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sports data provider is not available.";
    logAdminAction("sports_data_sync", auth.user.id, sportResult.data.id, "failed", message);
    return apiError(503, message);
  }

  try {
    const summary = await runFullSync(provider, sportCode, seasonExternalId, roundExternalId);
    const totalInserted = summary.seasons.inserted + summary.teams.inserted + summary.players.inserted + summary.rounds.inserted + summary.games.inserted + summary.gamePlayers.inserted + summary.playerGameStats.inserted;
    const totalErrors = [summary.seasons, summary.teams, summary.players, summary.rounds, summary.games, summary.gamePlayers, summary.playerGameStats].flatMap((s) => s.errors);
    logAdminAction("sports_data_sync", auth.user.id, sportResult.data.id, totalErrors.length === 0 ? "ok" : "failed", `provider=${summary.provider} inserted=${totalInserted} errors=${totalErrors.length}`);
    return apiOk({ summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed.";
    logAdminAction("sports_data_sync", auth.user.id, sportResult.data.id, "failed", message);
    return apiError(500, message);
  }
}
