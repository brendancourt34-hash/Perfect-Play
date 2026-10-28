import { apiError, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { getRequestUser } from "@/lib/auth/require";
import { hasUserAcceptedCurrentTerms, recordTermsAcceptance } from "@/lib/data/terms";

/** Whether the signed-in user has accepted the CURRENTLY published Terms — used to gate deposits/registration completion. */
export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return apiUnauthorized();

  const result = await hasUserAcceptedCurrentTerms(user.id);
  if (result.status === "unavailable") return apiUnavailable();

  return apiOk({
    accepted: result.data.accepted,
    currentVersion: result.data.currentVersion ? { id: result.data.currentVersion.id, versionNumber: result.data.currentVersion.versionNumber } : null,
  });
}

/**
 * Records acceptance of the Terms. The client must send the exact termsVersionId it saw
 * — this is checked against whatever is currently published so a stale/cached version id
 * (or an arbitrary client-supplied one) can never be recorded as an acceptance of terms
 * the user never actually saw.
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

  const termsVersionId = (body as { termsVersionId?: unknown })?.termsVersionId;
  if (typeof termsVersionId !== "number" || !Number.isInteger(termsVersionId)) {
    return apiError(422, "termsVersionId is required.");
  }

  const currentResult = await hasUserAcceptedCurrentTerms(user.id);
  if (currentResult.status === "unavailable") return apiUnavailable();
  if (!currentResult.data.currentVersion || currentResult.data.currentVersion.id !== termsVersionId) {
    return apiError(409, "This isn't the currently published Terms & Conditions — reload and try again.");
  }

  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = request.headers.get("user-agent");

  const result = await recordTermsAcceptance({ userId: user.id, termsVersionId, ipAddress, userAgent });
  if (result.status === "unavailable") return apiUnavailable();

  return apiOk({ accepted: true, acceptedAt: result.data.acceptedAt }, 201);
}
