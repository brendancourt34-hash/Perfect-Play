import { apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { getRequestUser } from "@/lib/auth/require";
import { getBalance } from "@/lib/data/wallet";

/** The signed-in user's own Perfect Play Balance — never another user's. */
export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return apiUnauthorized();

  const result = await getBalance(user.id);
  if (result.status === "unavailable") return apiUnavailable();

  return apiOk({ balanceCents: result.data, currency: "AUD" as const });
}
