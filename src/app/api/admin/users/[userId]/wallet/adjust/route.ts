import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { apiError, apiForbidden, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/require";
import { adjustWalletBalance } from "@/lib/data/wallet";
import { logAdminAction } from "@/lib/admin/audit-log";

/**
 * Manual admin balance correction — never a silent write. Requires the caller to already
 * be an authenticated admin (requireAdmin, same permission boundary as every other
 * /api/admin/* route) plus a non-empty `reason`, which is stored on the resulting
 * `adjustment` ledger row for a full audit trail (who did it is implicit in access logs,
 * why is explicit and mandatory here).
 */
export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const { userId: userIdParam } = await params;
  const userId = Number(userIdParam);
  if (!Number.isInteger(userId)) return apiNotFound("User");

  const userRows = await getDb().select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!userRows[0]) return apiNotFound("User");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Invalid request body.");
  }

  const { amountCents, reason } = (body as { amountCents?: unknown; reason?: unknown }) ?? {};
  if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents === 0) {
    return apiError(422, "amountCents must be a non-zero integer (positive to credit, negative to debit).");
  }
  if (typeof reason !== "string" || !reason.trim()) {
    return apiError(422, "A reason is required for every balance adjustment.");
  }

  const result = await adjustWalletBalance(userId, amountCents, reason.trim());
  if (result.status === "unavailable") return apiUnavailable();
  if (result.status === "insufficient_funds") {
    logAdminAction("wallet_adjust", auth.user.id, userId, "failed", `amountCents=${amountCents} insufficient_funds balance=${result.balanceCents}`);
    return apiError(422, `This debit would take the balance below zero (current: $${(result.balanceCents / 100).toFixed(2)}).`);
  }

  logAdminAction("wallet_adjust", auth.user.id, userId, "ok", `amountCents=${amountCents} reason=${reason.trim()} newBalanceCents=${result.newBalanceCents}`);
  return apiOk({ transaction: result.transaction, newBalanceCents: result.newBalanceCents });
}
