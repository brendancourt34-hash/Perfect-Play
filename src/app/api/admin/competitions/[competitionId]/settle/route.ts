import { requireAdmin } from "@/lib/auth/require";
import { settleCompetition } from "@/lib/data/settlement";
import { logAdminAction } from "@/lib/admin/audit-log";
import { apiError, apiForbidden, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

/**
 * Delegates entirely to the existing settlement orchestration
 * (src/lib/data/settlement.ts) — the settlement engine (src/lib/perfect2/settle.ts)
 * remains the sole source of truth for results. settleCompetition itself rejects an
 * still-open competition ("must be closed before it can be settled") and only actually
 * flips status to "settled" once every game in the round is final — this route does not
 * duplicate or bypass either check.
 */
export async function POST(request: Request, { params }: { params: Promise<{ competitionId: string }> }) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const { competitionId: competitionIdParam } = await params;
  const competitionId = Number(competitionIdParam);
  if (!Number.isInteger(competitionId)) return apiNotFound("Competition");

  const result = await settleCompetition(competitionId);
  if (result.status === "not_found") {
    logAdminAction("settle_competition", auth.user.id, competitionId, "failed", "not_found");
    return apiNotFound("Competition");
  }
  if (result.status === "invalid") {
    logAdminAction("settle_competition", auth.user.id, competitionId, "failed", result.errors.join("; "));
    return apiError(422, "Competition could not be settled.", result.errors);
  }
  if (result.status === "unavailable") {
    logAdminAction("settle_competition", auth.user.id, competitionId, "failed", result.message);
    return apiError(503, result.message);
  }
  logAdminAction("settle_competition", auth.user.id, competitionId, "ok", `perfectEntries=${result.summary.perfectEntryIds.length}`);
  return apiOk({ summary: result.summary });
}
