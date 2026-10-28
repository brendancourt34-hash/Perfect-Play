import type { TermsSection } from "@/db/schema";
import { apiError, apiForbidden, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/require";
import { getTermsVersionById, updateDraftTermsVersion } from "@/lib/data/terms";
import { logAdminAction } from "@/lib/admin/audit-log";

export async function GET(request: Request, { params }: { params: Promise<{ termsVersionId: string }> }) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const { termsVersionId: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) return apiNotFound("Terms version");

  const result = await getTermsVersionById(id);
  if (result.status === "unavailable") return apiUnavailable();
  if (!result.data) return apiNotFound("Terms version");
  return apiOk({ version: result.data });
}

/** Edits a draft's version number, effective date, and/or sections. Rejected once the version is published/archived — see updateDraftTermsVersion. */
export async function PATCH(request: Request, { params }: { params: Promise<{ termsVersionId: string }> }) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const { termsVersionId: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) return apiNotFound("Terms version");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Invalid request body.");
  }

  const { versionNumber, effectiveDate, content } = (body as Record<string, unknown>) ?? {};
  const patch: { versionNumber?: string; effectiveDate?: string; content?: TermsSection[] } = {};
  if (versionNumber !== undefined) {
    if (typeof versionNumber !== "string" || !versionNumber.trim()) return apiError(422, "versionNumber must be a non-empty string.");
    if (versionNumber.trim().length > 32) return apiError(422, "versionNumber must be 32 characters or fewer.");
    patch.versionNumber = versionNumber.trim();
  }
  if (effectiveDate !== undefined) {
    if (typeof effectiveDate !== "string" || !effectiveDate.trim()) return apiError(422, "effectiveDate must be a non-empty string.");
    patch.effectiveDate = effectiveDate;
  }
  if (content !== undefined) {
    if (!Array.isArray(content) || content.length === 0) return apiError(422, "content must be a non-empty array of sections.");
    const sections: TermsSection[] = [];
    for (const item of content) {
      if (typeof item !== "object" || item === null) return apiError(422, "Each section needs a heading and body.");
      const { heading, body: sectionBody } = item as Record<string, unknown>;
      if (typeof heading !== "string" || !heading.trim() || typeof sectionBody !== "string" || !sectionBody.trim()) {
        return apiError(422, "Each section needs a non-empty heading and body.");
      }
      sections.push({ heading: heading.trim(), body: sectionBody.trim() });
    }
    patch.content = sections;
  }

  const result = await updateDraftTermsVersion(id, patch);
  if (result.status === "unavailable") return apiUnavailable();
  if (result.status === "not_found") return apiNotFound("Terms version");
  if (result.status === "not_draft") {
    logAdminAction("terms_draft_edit", auth.user.id, id, "failed", `not_draft currentStatus=${result.currentStatus}`);
    return apiError(422, `This version is already ${result.currentStatus} and can no longer be edited.`);
  }
  logAdminAction("terms_draft_edit", auth.user.id, id, "ok", JSON.stringify(Object.keys(patch)));
  return apiOk({ version: result.version });
}
