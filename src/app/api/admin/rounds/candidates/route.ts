import { requireAdmin } from "@/lib/auth/require";
import { getSportByCode } from "@/lib/data/sports";
import { listCandidateGames } from "@/lib/data/schedule-pool";
import { apiError, apiForbidden, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

/**
 * Real, synced-but-not-yet-curated games within a date window, for admin round assembly —
 * generic across every sport (NRL/AFL/NBA/future). See src/lib/data/schedule-pool.ts.
 */
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const { searchParams } = new URL(request.url);
  const sportCode = searchParams.get("sportCode");
  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");
  if (!sportCode || !startDateParam || !endDateParam) return apiError(400, "sportCode, startDate, and endDate query params are required (dates as YYYY-MM-DD).");

  const startDate = new Date(`${startDateParam}T00:00:00Z`);
  const endDate = new Date(`${endDateParam}T23:59:59Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return apiError(400, "Invalid date format.");

  const sportResult = await getSportByCode(sportCode);
  if (sportResult.status === "unavailable") return apiUnavailable();
  if (!sportResult.data) return apiOk({ candidates: [] });

  const result = await listCandidateGames(sportResult.data.id, startDate, endDate);
  if (result.status === "unavailable") return apiUnavailable();
  return apiOk({ candidates: result.data });
}
