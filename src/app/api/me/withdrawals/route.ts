import { apiError, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { getRequestUser } from "@/lib/auth/require";
import { listWithdrawalsForUser, requestWithdrawal } from "@/lib/data/withdrawals";

/** The signed-in user's own withdrawal history — never another user's. */
export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return apiUnauthorized();

  const result = await listWithdrawalsForUser(user.id);
  if (result.status === "unavailable") return apiUnavailable();
  return apiOk({ withdrawals: result.data });
}

/**
 * Requests a withdrawal — this never moves money itself (see src/lib/data/withdrawals.ts):
 * it only records the request. No real payout mechanism exists yet; an admin later
 * processes it through /api/admin/withdrawals/[id]/status, and only a transition to
 * "completed" ever debits the wallet.
 */
export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return apiUnauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Invalid request body.");
  }

  const amountCents = (body as { amountCents?: unknown })?.amountCents;
  if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents <= 0) {
    return apiError(422, "amountCents must be a positive integer.");
  }

  const result = await requestWithdrawal(user.id, amountCents);
  if (result.status === "unavailable") return apiUnavailable();
  if (result.status === "insufficient_funds") {
    return apiError(422, `Insufficient Perfect Play Balance — you have $${(result.balanceCents / 100).toFixed(2)}.`);
  }
  return apiOk({ withdrawal: result.withdrawal }, 201);
}
