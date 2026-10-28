import { apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { getRequestUser } from "@/lib/auth/require";
import { listMomentsForUser, markMomentsRead } from "@/lib/data/moments";

/** The signed-in user's own Perfect Play Moments — never another user's. Optionally scoped to one competition via ?competitionId=. */
export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return apiUnauthorized();

  const url = new URL(request.url);
  const competitionIdParam = url.searchParams.get("competitionId");
  const competitionId = competitionIdParam ? Number(competitionIdParam) : undefined;

  const result = await listMomentsForUser(user.id, Number.isInteger(competitionId) ? competitionId : undefined);
  if (result.status === "unavailable") return apiUnavailable();
  return apiOk({ moments: result.data });
}

/** Marks every one of the signed-in user's currently-unread moments as read (in-app "seen" state only). */
export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return apiUnauthorized();

  const result = await markMomentsRead(user.id);
  if (result.status === "unavailable") return apiUnavailable();
  return apiOk({ updated: result.data });
}
