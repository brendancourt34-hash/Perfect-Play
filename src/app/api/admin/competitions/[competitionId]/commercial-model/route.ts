import { apiError, apiForbidden, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/require";
import { setCompetitionPrizePoolAllocationOverride } from "@/lib/data/competitions";
import { isValidPrizePoolAllocationBps } from "@/lib/perfect2/commercial";
import { logAdminAction } from "@/lib/admin/audit-log";

/**
 * Sets or clears ONE competition's Phase 23E commercial-economics prize-pool-allocation
 * override. This is a demonstration/reporting figure only — it never touches
 * prizeAmountCents, rollover, or any real settlement field (see
 * src/lib/data/competitions.ts:setCompetitionPrizePoolAllocationOverride).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ competitionId: string }> }) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const { competitionId: competitionIdParam } = await params;
  const competitionId = Number(competitionIdParam);
  if (!Number.isInteger(competitionId)) return apiNotFound("Competition");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Invalid request body.");
  }

  const { prizePoolAllocationBps } = (body as { prizePoolAllocationBps?: unknown }) ?? {};
  if (prizePoolAllocationBps !== null && !isValidPrizePoolAllocationBps(prizePoolAllocationBps as number)) {
    return apiError(422, "prizePoolAllocationBps must be null (to inherit the global default) or an integer between 0 and 10000 (e.g. 6000 = 60%).");
  }

  const result = await setCompetitionPrizePoolAllocationOverride(competitionId, prizePoolAllocationBps as number | null);
  if (result.status === "unavailable") return apiUnavailable();
  if (result.status === "not_found") return apiNotFound("Competition");
  if (result.status === "already_settled") {
    logAdminAction("competition_commercial_model_update", auth.user.id, competitionId, "failed", "rejected — competition is already settled, this figure is immutable once historical");
    return apiError(422, "This competition has already settled — its commercial-model figure is immutable once historical.");
  }

  logAdminAction(
    "competition_commercial_model_update",
    auth.user.id,
    competitionId,
    "ok",
    `prizePoolAllocationBps: ${result.previousBps} -> ${prizePoolAllocationBps}`,
  );
  return apiOk({ competition: result.competition });
}
