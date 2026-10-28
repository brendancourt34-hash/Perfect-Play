import { apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { getRequestUser } from "@/lib/auth/require";
import { listTransactionsForUser } from "@/lib/data/payment-transactions";

/** The signed-in user's own payment history — never another user's. Read-only, no admin bypass. */
export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return apiUnauthorized();

  const result = await listTransactionsForUser(user.id);
  if (result.status === "unavailable") return apiUnavailable();

  return apiOk({ transactions: result.data });
}
