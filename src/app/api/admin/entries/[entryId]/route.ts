import { requireAdmin } from "@/lib/auth/require";
import { getAdminEntryDetail } from "@/lib/data/admin";
import { apiForbidden, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

export async function GET(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const { entryId: entryIdParam } = await params;
  const entryId = Number(entryIdParam);
  if (!Number.isInteger(entryId)) return apiNotFound("Entry");

  const result = await getAdminEntryDetail(entryId);
  if (result.status === "unavailable") return apiUnavailable();
  if (!result.data) return apiNotFound("Entry");
  return apiOk(result.data);
}
