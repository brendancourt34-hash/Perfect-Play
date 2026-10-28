import { getRequestUser } from "@/lib/auth/require";
import { apiOk, apiUnauthorized } from "@/lib/api/response";

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return apiUnauthorized();
  return apiOk({ user });
}
