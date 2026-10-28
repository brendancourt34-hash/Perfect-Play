import { requireAdmin } from "@/lib/auth/require";
import { closeCompetition } from "@/lib/data/competitions";
import { logAdminAction } from "@/lib/admin/audit-log";
import { apiError, apiForbidden, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

/**
 * Delegates entirely to the existing closeCompetition orchestration
 * (src/lib/data/competitions.ts) — this route never writes `status` itself. That function
 * is already idempotent (closing an already-closed/settled competition is a no-op), so
 * there's no separate "is it currently open" check to duplicate here.
 */
export async function POST(request: Request, { params }: { params: Promise<{ competitionId: string }> }) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const { competitionId: competitionIdParam } = await params;
  const competitionId = Number(competitionIdParam);
  if (!Number.isInteger(competitionId)) return apiNotFound("Competition");

  const result = await closeCompetition(competitionId);
  if (result.status === "not_found") {
    logAdminAction("close_competition", auth.user.id, competitionId, "failed", "not_found");
    return apiNotFound("Competition");
  }
  if (result.status === "unavailable") {
    logAdminAction("close_competition", auth.user.id, competitionId, "failed", result.message);
    return apiError(503, result.message);
  }
  logAdminAction("close_competition", auth.user.id, competitionId, "ok", `status=${result.competition.status}`);
  return apiOk({ competition: result.competition });
}
