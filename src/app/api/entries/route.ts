import { listEntriesForUser } from "@/lib/data/entries";
import { getRequestUser } from "@/lib/auth/require";
import { apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

/** The authenticated user's own entries — never another user's. */
export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return apiUnauthorized();

  const result = await listEntriesForUser(user.id);
  if (result.status === "unavailable") return apiUnavailable();
  return apiOk({ entries: result.data });
}
