import { apiForbidden, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/require";
import { listAcceptancesForVersion } from "@/lib/data/terms";

/** Every user who has accepted this specific version — admin audit view. */
export async function GET(request: Request, { params }: { params: Promise<{ termsVersionId: string }> }) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const { termsVersionId: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) return apiNotFound("Terms version");

  const result = await listAcceptancesForVersion(id);
  if (result.status === "unavailable") return apiUnavailable();
  return apiOk({ acceptances: result.data });
}
