import { apiForbidden, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/require";
import { listAllWithdrawals } from "@/lib/data/withdrawals";

/** Every withdrawal request across every user — admin queue for processing. */
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const result = await listAllWithdrawals();
  if (result.status === "unavailable") return apiUnavailable();
  return apiOk({ withdrawals: result.data });
}
