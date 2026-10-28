import { withdrawalStatusValues, type WithdrawalStatus } from "@/db/schema";
import { apiError, apiForbidden, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/require";
import { updateWithdrawalStatus } from "@/lib/data/withdrawals";
import { logAdminAction } from "@/lib/admin/audit-log";

const STATUS_SET = new Set<string>(withdrawalStatusValues);

/**
 * Admin transitions a withdrawal's status. Only a transition to "completed" ever debits
 * the wallet (atomically, insufficient-funds-safe) — see
 * src/lib/data/withdrawals.ts:updateWithdrawalStatus. A withdrawal already in a terminal
 * status (completed/rejected/cancelled) can never be transitioned again.
 */
export async function POST(request: Request, { params }: { params: Promise<{ withdrawalId: string }> }) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const { withdrawalId: withdrawalIdParam } = await params;
  const withdrawalId = Number(withdrawalIdParam);
  if (!Number.isInteger(withdrawalId)) return apiNotFound("Withdrawal");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Invalid request body.");
  }

  const { status, adminNote } = (body as { status?: unknown; adminNote?: unknown }) ?? {};
  if (typeof status !== "string" || !STATUS_SET.has(status)) {
    return apiError(422, `status must be one of: ${withdrawalStatusValues.join(", ")}.`);
  }
  if (adminNote !== undefined && typeof adminNote !== "string") {
    return apiError(422, "adminNote must be a string.");
  }

  const result = await updateWithdrawalStatus(withdrawalId, status as WithdrawalStatus, adminNote);
  if (result.status === "unavailable") return apiUnavailable();
  if (result.status === "not_found") return apiNotFound("Withdrawal");
  if (result.status === "already_terminal") {
    logAdminAction("withdrawal_status", auth.user.id, withdrawalId, "failed", `requestedStatus=${status} alreadyTerminal=${result.currentStatus}`);
    return apiError(422, `This withdrawal is already ${result.currentStatus} and cannot be changed.`);
  }
  if (result.status === "insufficient_funds") {
    logAdminAction("withdrawal_status", auth.user.id, withdrawalId, "failed", `requestedStatus=${status} insufficient_funds balance=${result.balanceCents}`);
    return apiError(422, `Cannot complete — the user's balance ($${(result.balanceCents / 100).toFixed(2)}) no longer covers this withdrawal.`);
  }
  logAdminAction("withdrawal_status", auth.user.id, withdrawalId, "ok", `newStatus=${result.withdrawal.status}`);
  return apiOk({ withdrawal: result.withdrawal });
}
