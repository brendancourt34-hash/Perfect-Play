import { requireAdmin } from "@/lib/auth/require";
import { getSportByCode } from "@/lib/data/sports";
import { regenerateRoundGameSelection } from "@/lib/data/auto-round-selection";
import { logAdminAction } from "@/lib/admin/audit-log";
import { apiError, apiForbidden, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

interface RegenerateBody {
  sportCode?: string;
  seasonId?: number;
  roundNumber?: number;
}

/** Discards a not-yet-locked selection and generates a fresh one. Rejected outright once locked — see lockRoundGameSelection. */
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  let body: RegenerateBody;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Invalid request body.");
  }
  const { sportCode, seasonId, roundNumber } = body;
  if (!sportCode || !Number.isInteger(seasonId) || !Number.isInteger(roundNumber)) {
    return apiError(400, "sportCode, seasonId, and roundNumber are all required.");
  }

  const sportResult = await getSportByCode(sportCode);
  if (sportResult.status === "unavailable") return apiUnavailable();
  if (!sportResult.data) return apiNotFound("Sport");

  const result = await regenerateRoundGameSelection(sportCode, sportResult.data.id, seasonId!, roundNumber!, auth.user.id);
  if (result.status === "unavailable") return apiUnavailable();
  if (result.status === "already_locked") {
    logAdminAction(`${sportCode}_regenerate_selection`, auth.user.id, seasonId!, "failed", "selection is already locked");
    return apiError(422, "This selection is already locked and cannot be regenerated.");
  }
  if (result.status === "invalid") return apiError(422, "Could not regenerate a game selection.", result.errors);
  if (result.status === "insufficient") {
    logAdminAction(`${sportCode}_regenerate_selection`, auth.user.id, seasonId!, "failed", `insufficient eligible games: ${result.eligibleCount}/${result.required}`);
    return apiError(422, `Unable to regenerate selection — fewer than ${result.required} eligible games.`, [
      `Eligible games: ${result.eligibleCount}`,
      `Required: ${result.required}`,
      ...(result.details ?? []),
    ]);
  }

  logAdminAction(`${sportCode}_regenerate_selection`, auth.user.id, result.selection.id, "ok", `games=${result.selection.selectedGameIds.length}`);
  return apiOk({ selection: result.selection, games: result.games });
}
