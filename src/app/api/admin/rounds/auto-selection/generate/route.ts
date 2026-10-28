import { requireAdmin } from "@/lib/auth/require";
import { getSportByCode } from "@/lib/data/sports";
import { generateRoundGameSelection } from "@/lib/data/auto-round-selection";
import { logAdminAction } from "@/lib/admin/audit-log";
import { apiError, apiForbidden, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

interface GenerateBody {
  sportCode?: string;
  seasonId?: number;
  roundNumber?: number;
}

/**
 * Server-authoritative NBA/NFL automated 8-game selection — the client only ever says
 * "generate for this round"; the seed, the shuffle, and the resulting 8 game IDs are
 * entirely decided here, never supplied by the caller. See
 * src/lib/perfect2/game-selection.ts (pure algorithm) and
 * src/lib/data/auto-round-selection.ts (orchestration/persistence/idempotency).
 * Does NOT create a real round or touch any game — see lockRoundGameSelection for that.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  let body: GenerateBody;
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

  const result = await generateRoundGameSelection(sportCode, sportResult.data.id, seasonId!, roundNumber!, auth.user.id);
  if (result.status === "unavailable") return apiUnavailable();
  if (result.status === "invalid") return apiError(422, "Could not generate a game selection.", result.errors);
  if (result.status === "insufficient") {
    logAdminAction(`${sportCode}_generate_selection`, auth.user.id, seasonId!, "failed", `insufficient eligible games: ${result.eligibleCount}/${result.required}`);
    return apiError(422, `Unable to generate selection — fewer than ${result.required} eligible games.`, [
      `Eligible games: ${result.eligibleCount}`,
      `Required: ${result.required}`,
      ...(result.details ?? []),
    ]);
  }

  logAdminAction(`${sportCode}_generate_selection`, auth.user.id, result.selection.id, "ok", `alreadyExisted=${result.alreadyExisted} games=${result.selection.selectedGameIds.length}`);
  return apiOk({ selection: result.selection, games: result.games, alreadyExisted: result.alreadyExisted }, result.alreadyExisted ? 200 : 201);
}
