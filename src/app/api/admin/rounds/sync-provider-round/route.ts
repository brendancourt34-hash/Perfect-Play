import { requireAdmin } from "@/lib/auth/require";
import { getOrCreateSport } from "@/lib/data/sports";
import { getOrCreateSchedulePoolRound } from "@/lib/data/schedule-pool";
import { getNflSportsDataProvider, getSportsDataProvider } from "@/lib/sports-data/registry";
import { syncProviderGamesIntoPool, syncRounds, syncSeasons, syncTeams } from "@/lib/sports-data/sync";
import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";
import { logAdminAction } from "@/lib/admin/audit-log";
import { apiError, apiForbidden, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

interface SyncBody {
  sportCode?: string;
  sportName?: string;
  seasonExternalId?: string;
  roundExternalId?: string;
}

/**
 * NRL/AFL equivalent of /api/admin/nba/sync-schedule — for a provider WITH a native
 * "round" concept (see syncProviderGamesIntoPool, src/lib/sports-data/sync.ts). Pulls one
 * real provider round's games into the sport's schedule pool for admin curation
 * (GET /api/admin/rounds/candidates) rather than directly into a customer-facing round —
 * this is what lets a Perfect Play round contain fewer games than the full real round (e.g.
 * only 6 suitable games during a State of Origin week) instead of an automatic mirror of
 * the entire fixture. Uses the existing sports-data provider registry — today that's
 * "none" (Champion Data not yet connected) or the explicit "mock" dev/test fixture; never
 * fabricates a connection.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  let body: SyncBody;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Malformed request body.");
  }
  const { sportCode, sportName, seasonExternalId, roundExternalId } = body;
  if (!sportCode || !sportName || !seasonExternalId || !roundExternalId) {
    return apiError(400, "sportCode, sportName, seasonExternalId, and roundExternalId are all required.");
  }

  const sportResult = await getOrCreateSport(sportCode, sportName);
  if (sportResult.status === "unavailable") return apiUnavailable();
  const sport = sportResult.data;

  let provider;
  try {
    // NBA uses the separate date-range sync endpoint (/api/admin/nba/sync-schedule), not
    // this one — every "round" provider (NRL/AFL's Champion Data, NFL's not-yet-connected
    // source) resolves through its own sport-specific config so NFL never silently reuses
    // NRL/AFL's provider status.
    provider = sportCode === "nfl" ? getNflSportsDataProvider() : getSportsDataProvider();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sports data provider is not available.";
    logAdminAction(`${sportCode}_sync_provider_round`, auth.user.id, sport.id, "failed", message);
    return apiError(503, message);
  }

  try {
    const seasonsSummary = await syncSeasons(provider, sportCode);
    const teamsSummary = await syncTeams(provider, sportCode);
    const roundsSummary = await syncRounds(provider, seasonExternalId);

    const db = getDb();
    const seasonRows = await db.select().from(schema.seasons).where(eq(schema.seasons.externalId, seasonExternalId)).limit(1);
    const season = seasonRows[0];
    if (!season) return apiError(503, `Season "${seasonExternalId}" was not found after syncing — check the provider returned it.`);

    const poolRoundResult = await getOrCreateSchedulePoolRound(season.id);
    if (poolRoundResult.status === "unavailable") return apiUnavailable();
    const poolRound = poolRoundResult.data;

    const gamesSummary = await syncProviderGamesIntoPool(provider, poolRound.id, roundExternalId);

    const totalErrors = [seasonsSummary, teamsSummary, roundsSummary, gamesSummary].flatMap((s) => s.errors);
    logAdminAction(
      `${sportCode}_sync_provider_round`,
      auth.user.id,
      sport.id,
      totalErrors.length === 0 ? "ok" : "failed",
      `games=${gamesSummary.inserted + gamesSummary.updated} errors=${totalErrors.length} selectionsVoided=${gamesSummary.selectionsVoided}`,
    );

    return apiOk({ seasonId: season.id, poolRoundId: poolRound.id, seasons: seasonsSummary, teams: teamsSummary, rounds: roundsSummary, games: gamesSummary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Schedule sync failed.";
    logAdminAction(`${sportCode}_sync_provider_round`, auth.user.id, sport.id, "failed", message);
    return apiError(500, message);
  }
}
