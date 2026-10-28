import { apiError, apiForbidden, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/require";
import { publishTermsVersion } from "@/lib/data/terms";
import { logAdminAction } from "@/lib/admin/audit-log";

/** Publishes a draft — archives whatever version was previously published, if any. See publishTermsVersion for the immutability guarantees. */
export async function POST(request: Request, { params }: { params: Promise<{ termsVersionId: string }> }) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const { termsVersionId: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) return apiNotFound("Terms version");

  const result = await publishTermsVersion(id);
  if (result.status === "unavailable") return apiUnavailable();
  if (result.status === "not_found") return apiNotFound("Terms version");
  if (result.status === "not_draft") {
    logAdminAction("terms_publish", auth.user.id, id, "failed", `not_draft currentStatus=${result.currentStatus}`);
    return apiError(422, `This version is already ${result.currentStatus} and cannot be republished.`);
  }
  logAdminAction("terms_publish", auth.user.id, id, "ok", `versionNumber=${result.version.versionNumber}`);
  return apiOk({ version: result.version });
}
