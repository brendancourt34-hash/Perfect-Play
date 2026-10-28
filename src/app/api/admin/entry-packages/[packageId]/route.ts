import { apiError, apiForbidden, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/require";
import { updateEntryPackage, type UpdateEntryPackageInput } from "@/lib/data/entry-packages";
import { logAdminAction } from "@/lib/admin/audit-log";

/** Edits or deactivates a package — every field optional (partial update). Applies only to future purchases; past purchases keep their own recorded price/entry count forever. */
export async function PATCH(request: Request, { params }: { params: Promise<{ packageId: string }> }) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const { packageId: packageIdParam } = await params;
  const packageId = Number(packageIdParam);
  if (!Number.isInteger(packageId)) return apiNotFound("Entry package");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Invalid request body.");
  }

  const { entryCount, priceCents, label, badge, active, displayOrder } = (body as Record<string, unknown>) ?? {};
  const patch: UpdateEntryPackageInput = {};
  if (entryCount !== undefined) {
    if (typeof entryCount !== "number" || !Number.isInteger(entryCount) || entryCount <= 0) return apiError(422, "entryCount must be a positive integer.");
    patch.entryCount = entryCount;
  }
  if (priceCents !== undefined) {
    if (typeof priceCents !== "number" || !Number.isInteger(priceCents) || priceCents <= 0) return apiError(422, "priceCents must be a positive integer.");
    patch.priceCents = priceCents;
  }
  if (label !== undefined) {
    if (typeof label !== "string" || !label.trim()) return apiError(422, "label must be a non-empty string.");
    patch.label = label.trim();
  }
  if (badge !== undefined) patch.badge = typeof badge === "string" && badge.trim() ? badge.trim() : null;
  if (active !== undefined) {
    if (typeof active !== "boolean") return apiError(422, "active must be a boolean.");
    patch.active = active;
  }
  if (displayOrder !== undefined) {
    if (typeof displayOrder !== "number" || !Number.isInteger(displayOrder)) return apiError(422, "displayOrder must be an integer.");
    patch.displayOrder = displayOrder;
  }

  const result = await updateEntryPackage(packageId, patch);
  if (result.status === "unavailable") return apiUnavailable();
  if (!result.data) return apiNotFound("Entry package");
  logAdminAction("entry_package_update", auth.user.id, packageId, "ok", JSON.stringify(patch));
  return apiOk({ package: result.data });
}
