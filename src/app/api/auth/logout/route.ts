import { revokeSessionToken } from "@/lib/data/auth";
import { extractBearerToken } from "@/lib/auth/session";
import { apiError, apiOk } from "@/lib/api/response";

export async function POST(request: Request) {
  const bearer = extractBearerToken(request.headers.get("authorization"));
  const cookieToken = bearer ? null : readSessionCookie(request.headers.get("cookie"));
  const token = bearer ?? cookieToken;
  if (!token) return apiError(400, "No session token provided.");

  await revokeSessionToken(token);
  const response = apiOk({ loggedOut: true });
  if (cookieToken) response.cookies.delete("session");
  return response;
}

function readSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === "session") return decodeURIComponent(rest.join("="));
  }
  return null;
}
