import { apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { getRequestUser } from "@/lib/auth/require";
import { listWalletTransactions } from "@/lib/data/wallet";

/** The signed-in user's own wallet ledger, newest first — never another user's. */
export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return apiUnauthorized();

  const result = await listWalletTransactions(user.id);
  if (result.status === "unavailable") return apiUnavailable();

  return apiOk({ transactions: result.data });
}
