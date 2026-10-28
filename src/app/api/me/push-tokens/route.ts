import { apiError, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { getRequestUser } from "@/lib/auth/require";
import { registerPushToken, removePushTokenForUser } from "@/lib/data/push-tokens";
import { pushTokenPlatformValues, type PushTokenPlatform } from "@/db/schema";

/**
 * Registers this device's push token against the signed-in user — architecture boundary
 * only. No push is actually ever sent from this codebase yet (expo-notifications isn't
 * installed in mobile/); this exists so wiring up real push later is a pure addition, not
 * a schema/API change at that point.
 */
export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return apiUnauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Invalid JSON body.");
  }
  const { token, platform } = body as { token?: unknown; platform?: unknown };
  if (typeof token !== "string" || token.length === 0) return apiError(400, "token is required.");
  if (typeof platform !== "string" || !pushTokenPlatformValues.includes(platform as PushTokenPlatform)) {
    return apiError(400, `platform must be one of: ${pushTokenPlatformValues.join(", ")}.`);
  }

  const result = await registerPushToken(user.id, token, platform as PushTokenPlatform);
  if (result.status === "unavailable") return apiUnavailable();
  return apiOk({ registered: true });
}

export async function DELETE(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return apiUnauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Invalid JSON body.");
  }
  const { token } = body as { token?: unknown };
  if (typeof token !== "string" || token.length === 0) return apiError(400, "token is required.");

  const result = await removePushTokenForUser(user.id, token);
  if (result.status === "unavailable") return apiUnavailable();
  return apiOk({ removed: true });
}
