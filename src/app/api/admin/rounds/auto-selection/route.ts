import { requireAdmin } from "@/lib/auth/require";
import { getSportByCode } from "@/lib/data/sports";
import { getRoundGameSelection } from "@/lib/data/auto-round-selection";
import { apiError, apiForbidden, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

/**
 * Admin-only read of an NBA/NFL automated game-selection's current state — used by the
 * admin UI to poll/display "not generated yet" / "8 games selected (GENERATED)" /
 * "LOCKED". Never exposes anything a customer-facing endpoint would (this route is
 * behind requireAdmin, same as every other /api/admin/* route).
 */
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const { searchParams } = new URL(request.url);
  const sportCode = searchParams.get("sportCode");
  const seasonId = Number(searchParams.get("seasonId"));
  const roundNumber = Number(searchParams.get("roundNumber"));
  if (!sportCode || !Number.isInteger(seasonId) || !Number.isInteger(roundNumber)) {
    return apiError(400, "sportCode, seasonId, and roundNumber query params are all required.");
  }

  const sportResult = await getSportByCode(sportCode);
  if (sportResult.status === "unavailable") return apiUnavailable();
  if (!sportResult.data) return apiNotFound("Sport");

  const result = await getRoundGameSelection(sportResult.data.id, seasonId, roundNumber);
  if (result.status === "unavailable") return apiUnavailable();
  if (result.status === "not_found") return apiOk({ exists: false });
  return apiOk({ exists: true, selection: result.selection, games: result.games });
}
