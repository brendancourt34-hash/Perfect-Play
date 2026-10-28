import { apiError, apiForbidden, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/require";
import { setPlatformSetting } from "@/lib/data/platform-settings";
import { isValidPrizePoolAllocationBps } from "@/lib/perfect2/commercial";
import { logAdminAction } from "@/lib/admin/audit-log";

const ALLOWED_KEYS = new Set(["max_entries_per_round", "prize_pool_allocation_bps"]);

/**
 * Generic admin settings writer, restricted to an explicit allowlist of keys — never lets
 * the client invent an arbitrary settings row. Applies only to reads that happen after
 * this call; past purchases/entries already recorded their own actual values and are
 * never retroactively affected by a later settings change.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const { key } = await params;
  if (!ALLOWED_KEYS.has(key)) return apiError(404, "Unknown setting.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Invalid request body.");
  }

  const { value } = (body as { value?: unknown }) ?? {};
  if (key === "max_entries_per_round" && (typeof value !== "number" || !Number.isInteger(value) || value <= 0)) {
    return apiError(422, "value must be a positive integer.");
  }
  if (key === "prize_pool_allocation_bps" && (typeof value !== "number" || !isValidPrizePoolAllocationBps(value))) {
    return apiError(422, "value must be an integer number of basis points between 0 and 10000 (e.g. 6000 = 60%).");
  }

  const result = await setPlatformSetting(key, value);
  if (result.status === "unavailable") return apiUnavailable();
  logAdminAction(
    "platform_setting_update",
    auth.user.id,
    0,
    "ok",
    `key=${key} value: ${JSON.stringify(result.data.previousValue)} -> ${JSON.stringify(value)}`,
  );
  return apiOk({ setting: result.data.setting });
}
