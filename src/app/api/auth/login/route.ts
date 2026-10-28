import { loginUser } from "@/lib/data/auth";
import { SESSION_DURATION_MS } from "@/lib/auth/session";
import { apiError, apiOk, apiUnavailable } from "@/lib/api/response";

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Invalid request body.");
  }
  if (!body.email || !body.password) return apiError(400, "Email and password are required.");

  const result = await loginUser(body.email, body.password);
  if (result.status === "ok") {
    const response = apiOk({ user: result.user, token: result.token });
    // The mobile app ignores this and uses `token` from the body instead (SecureStore +
    // Bearer header) — this only completes the web app's half of getRequestUser
    // (src/lib/auth/require.ts), which has always checked for a `session` cookie but
    // never had anything actually set it until now. Same session table, same token.
    response.cookies.set("session", result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DURATION_MS / 1000,
    });
    return response;
  }
  if (result.status === "invalid") return apiError(401, "Login failed.", result.errors);
  return apiUnavailable();
}
