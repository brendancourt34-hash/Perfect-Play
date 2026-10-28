import { apiError, apiForbidden, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/require";
import { createEntryPackage, listAllEntryPackages } from "@/lib/data/entry-packages";
import { logAdminAction } from "@/lib/admin/audit-log";

/** Every package including inactive ones — admin-only view (customers only ever see listActiveEntryPackages via /api/entry-packages). */
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const result = await listAllEntryPackages();
  if (result.status === "unavailable") return apiUnavailable();
  return apiOk({ packages: result.data });
}

/** Adds a new purchasable package. Never affects entries/purchases already made. */
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

  const { entryCount, priceCents, label, badge, displayOrder } = (body as Record<string, unknown>) ?? {};
  if (typeof entryCount !== "number" || !Number.isInteger(entryCount) || entryCount <= 0) {
    return apiError(422, "entryCount must be a positive integer.");
  }
  if (typeof priceCents !== "number" || !Number.isInteger(priceCents) || priceCents <= 0) {
    return apiError(422, "priceCents must be a positive integer.");
  }
  if (typeof label !== "string" || !label.trim()) {
    return apiError(422, "label is required.");
  }

  const result = await createEntryPackage({
    entryCount,
    priceCents,
    label: label.trim(),
    badge: typeof badge === "string" && badge.trim() ? badge.trim() : null,
    displayOrder: typeof displayOrder === "number" ? displayOrder : 0,
  });
  if (result.status === "unavailable") return apiUnavailable();
  logAdminAction("entry_package_create", auth.user.id, result.data.id, "ok", `entryCount=${entryCount} priceCents=${priceCents} label=${label.trim()}`);
  return apiOk({ package: result.data }, 201);
}
