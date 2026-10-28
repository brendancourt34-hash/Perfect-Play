import { apiError, apiForbidden, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/require";
import { createDraftTermsVersion, listTermsVersions } from "@/lib/data/terms";
import type { TermsSection } from "@/db/schema";
import { logAdminAction } from "@/lib/admin/audit-log";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const result = await listTermsVersions();
  if (result.status === "unavailable") return apiUnavailable();
  return apiOk({ versions: result.data });
}

function validateSections(value: unknown): TermsSection[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const sections: TermsSection[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const { heading, body } = item as Record<string, unknown>;
    if (typeof heading !== "string" || !heading.trim() || typeof body !== "string" || !body.trim()) return null;
    sections.push({ heading: heading.trim(), body: body.trim() });
  }
  return sections;
}

/** Creates a new draft version — never published automatically. Publishing is a separate, explicit admin action (POST .../publish). */
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Invalid request body.");
  }

  const { versionNumber, effectiveDate, content } = (body as Record<string, unknown>) ?? {};
  if (typeof versionNumber !== "string" || !versionNumber.trim()) return apiError(422, "versionNumber is required.");
  if (versionNumber.trim().length > 32) return apiError(422, "versionNumber must be 32 characters or fewer.");
  if (typeof effectiveDate !== "string" || !effectiveDate.trim()) return apiError(422, "effectiveDate is required (YYYY-MM-DD).");
  const sections = validateSections(content);
  if (!sections) return apiError(422, "content must be a non-empty array of {heading, body} sections, all non-empty.");

  const result = await createDraftTermsVersion({ versionNumber: versionNumber.trim(), effectiveDate, content: sections, createdByUserId: auth.user.id });
  if (result.status === "unavailable") return apiUnavailable();
  logAdminAction("terms_draft_create", auth.user.id, result.data.id, "ok", `versionNumber=${versionNumber.trim()}`);
  return apiOk({ version: result.data }, 201);
}
