import { requireAdmin } from "@/lib/auth/require";
import { getOrCreateSport } from "@/lib/data/sports";
import { getOrCreateSchedulePoolRound } from "@/lib/data/schedule-pool";
import { getNbaSportsDataProvider } from "@/lib/sports-data/registry";
import { syncGamesForDateRange, syncSeasons, syncTeams } from "@/lib/sports-data/sync";
import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";
import { logAdminAction } from "@/lib/admin/audit-log";
import { apiError, apiForbidden, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

interface SyncScheduleBody {
  startDate?: string;
  endDate?: string;
}

/**
 * Syncs the real NBA schedule (via the real, live, keyless getNbaSportsDataProvider —
 * defaults to NbaEspnProvider, see src/lib/sports-data/registry.ts) for a date window
 * into the NBA schedule pool, ready for admin curation into a Perfect Play round
 * (POST /api/admin/nba/rounds). Never fabricates games/teams — every row written here
 * came from a real HTTP response.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  let body: SyncScheduleBody;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Malformed request body.");
  }
  if (!body.startDate || !body.endDate) return apiError(400, "startDate and endDate are required (YYYY-MM-DD).");

  const sportResult = await getOrCreateSport("nba", "NBA");
  if (sportResult.status === "unavailable") return apiUnavailable();
  const sport = sportResult.data;

  let provider;
  try {
    provider = getNbaSportsDataProvider();
  } catch (error) {
    const message = error instanceof Error ? error.message : "NBA sports data provider is not available.";
    logAdminAction("nba_sync_schedule", auth.user.id, sport.id, "failed", message);
    return apiError(503, message);
  }

  try {
    const seasonsSummary = await syncSeasons(provider, "nba");
    const db = getDb();
    const seasonRows = await db.select().from(schema.seasons).where(eq(schema.seasons.sportId, sport.id)).limit(1);
    const season = seasonRows[0];
    if (!season) return apiError(503, "NBA season sync returned no season — cannot proceed.");

    const teamsSummary = await syncTeams(provider, "nba");

    const poolRoundResult = await getOrCreateSchedulePoolRound(season.id);
    if (poolRoundResult.status === "unavailable") return apiUnavailable();
    const poolRound = poolRoundResult.data;

    const gamesSummary = await syncGamesForDateRange(provider, poolRound.id, body.startDate, body.endDate);

    const totalErrors = [seasonsSummary, teamsSummary, gamesSummary].flatMap((s) => s.errors);
    logAdminAction(
      "nba_sync_schedule",
      auth.user.id,
      sport.id,
      totalErrors.length === 0 ? "ok" : "failed",
      `games=${gamesSummary.inserted + gamesSummary.updated} errors=${totalErrors.length} selectionsVoided=${gamesSummary.selectionsVoided}`,
    );

    return apiOk({ seasonId: season.id, poolRoundId: poolRound.id, seasons: seasonsSummary, teams: teamsSummary, games: gamesSummary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "NBA schedule sync failed.";
    logAdminAction("nba_sync_schedule", auth.user.id, sport.id, "failed", message);
    return apiError(500, message);
  }
}
