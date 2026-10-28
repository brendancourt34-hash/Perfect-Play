import { requireAdmin } from "@/lib/auth/require";
import { getSportByCode } from "@/lib/data/sports";
import { lockRoundGameSelection } from "@/lib/data/auto-round-selection";
import { logAdminAction } from "@/lib/admin/audit-log";
import { apiError, apiForbidden, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

interface LockBody {
  sportCode?: string;
  seasonId?: number;
  roundNumber?: number;
  roundName?: string;
}

/**
 * Turns a GENERATED NBA/NFL selection into a real, customer-facing round — see
 * lockRoundGameSelection's doc comment for exactly what this does and why it's the one
 * point where the selection becomes visible/enterable. Irreversible through this normal
 * admin flow: once locked, generate/regenerate for this round are both rejected.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  let body: LockBody;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Invalid request body.");
  }
  const { sportCode, seasonId, roundNumber, roundName } = body;
  if (!sportCode || !Number.isInteger(seasonId) || !Number.isInteger(roundNumber) || !roundName) {
    return apiError(400, "sportCode, seasonId, roundNumber, and roundName are all required.");
  }

  const sportResult = await getSportByCode(sportCode);
  if (sportResult.status === "unavailable") return apiUnavailable();
  if (!sportResult.data) return apiNotFound("Sport");

  const result = await lockRoundGameSelection({
    sportCode,
    sportId: sportResult.data.id,
    seasonId: seasonId!,
    roundNumber: roundNumber!,
    roundName,
    adminUserId: auth.user.id,
  });
  if (result.status === "unavailable") return apiUnavailable();
  if (result.status === "not_found") return apiNotFound("Game selection (generate one first)");
  if (result.status === "invalid") {
    logAdminAction(`${sportCode}_lock_selection`, auth.user.id, seasonId!, "failed", result.errors.join("; "));
    return apiError(422, "Could not lock this game selection.", result.errors);
  }

  logAdminAction(`${sportCode}_lock_selection`, auth.user.id, result.roundId, "ok", `alreadyLocked=${result.alreadyLocked}`);
  return apiOk({ roundId: result.roundId, alreadyLocked: result.alreadyLocked }, result.alreadyLocked ? 200 : 201);
}
