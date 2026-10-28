import { requireAdmin } from "@/lib/auth/require";
import { getAdminCompetitionDetail, listAdminEntriesForCompetition } from "@/lib/data/admin";
import { apiForbidden, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

export async function GET(request: Request, { params }: { params: Promise<{ competitionId: string }> }) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const { competitionId: competitionIdParam } = await params;
  const competitionId = Number(competitionIdParam);
  if (!Number.isInteger(competitionId)) return apiNotFound("Competition");

  const competitionResult = await getAdminCompetitionDetail(competitionId);
  if (competitionResult.status === "unavailable") return apiUnavailable();
  if (!competitionResult.data) return apiNotFound("Competition");

  const result = await listAdminEntriesForCompetition(competitionId);
  if (result.status === "unavailable") return apiUnavailable();
  return apiOk({ entries: result.data });
}
