import { requireAdmin } from "@/lib/auth/require";
import { getAdminCompetitionDetail } from "@/lib/data/admin";
import { apiForbidden, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

export async function GET(request: Request, { params }: { params: Promise<{ competitionId: string }> }) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const { competitionId: competitionIdParam } = await params;
  const competitionId = Number(competitionIdParam);
  if (!Number.isInteger(competitionId)) return apiNotFound("Competition");

  const result = await getAdminCompetitionDetail(competitionId);
  if (result.status === "unavailable") return apiUnavailable();
  if (!result.data) return apiNotFound("Competition");
  return apiOk(result.data);
}
