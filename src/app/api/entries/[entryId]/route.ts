import { getEntryWithResult } from "@/lib/data/entries";
import { getRequestUser } from "@/lib/auth/require";
import { apiError, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

/** An entry's full per-game result — only its owner may read it. */
export async function GET(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  const { entryId: entryIdParam } = await params;
  const entryId = Number(entryIdParam);
  if (!Number.isInteger(entryId)) return apiNotFound("Entry");

  const user = await getRequestUser(request);
  if (!user) return apiUnauthorized();

  const result = await getEntryWithResult(entryId);
  if (result.status === "unavailable") return apiUnavailable();
  if (!result.data) return apiNotFound("Entry");
  if (result.data.userId !== user.id) return apiError(403, "You don't have access to this entry.");

  return apiOk({ entry: result.data });
}
