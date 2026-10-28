import { requireAdmin } from "@/lib/auth/require";
import { getAdminDashboard } from "@/lib/data/admin";
import { apiForbidden, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const result = await getAdminDashboard();
  if (result.status === "unavailable") return apiUnavailable();
  return apiOk(result.data);
}
