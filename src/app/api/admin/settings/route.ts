import { apiForbidden, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/require";
import { listPlatformSettings } from "@/lib/data/platform-settings";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const result = await listPlatformSettings();
  if (result.status === "unavailable") return apiUnavailable();
  return apiOk({ settings: result.data });
}
