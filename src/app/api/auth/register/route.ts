import { registerUser } from "@/lib/data/auth";
import { apiError, apiOk, apiUnavailable } from "@/lib/api/response";

export async function POST(request: Request) {
  let body: { email?: string; password?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Invalid request body.");
  }
  if (!body.email || !body.password) return apiError(400, "Email and password are required.");

  const result = await registerUser(body.email, body.password, body.name ?? "");
  if (result.status === "ok") return apiOk({ user: result.user, token: result.token }, 201);
  if (result.status === "invalid") return apiError(422, "Registration failed.", result.errors);
  return apiUnavailable();
}
