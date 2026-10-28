import { getUserForSessionToken, isUserAdmin, type PublicUser } from "@/lib/data/auth";
import { extractBearerToken } from "./session";

/**
 * Resolves the authenticated user for an API request, checking (in order) the
 * Authorization: Bearer header — the mobile app's mechanism — then a `session` cookie —
 * the web app's mechanism. Both paths verify against the same `sessions` table, so a
 * token issued to either client works the same way server-side. Returns null rather than
 * throwing; callers decide whether to 401.
 */
export async function getRequestUser(request: Request): Promise<PublicUser | null> {
  const bearer = extractBearerToken(request.headers.get("authorization"));
  const cookieToken = bearer ? null : readCookie(request.headers.get("cookie"), "session");
  const token = bearer ?? cookieToken;
  if (!token) return null;

  const result = await getUserForSessionToken(token);
  return result.status === "ok" ? result.data : null;
}

export type RequireAdminResult =
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "unavailable"; message: string }
  | { status: "ok"; user: PublicUser };

/**
 * Admin-dashboard authorization (Phase 18). Reuses getRequestUser (same session system —
 * no second auth mechanism) and layers a server-side isAdmin check on top; the admin flag
 * itself is never exposed to any client response (see isUserAdmin, src/lib/data/auth.ts).
 * Every /api/admin/* route must call this and branch on the result — the admin UI being
 * hidden from normal users is never treated as a security boundary on its own.
 */
export async function requireAdmin(request: Request): Promise<RequireAdminResult> {
  // Deliberately does NOT go through getRequestUser: that helper collapses "database
  // temporarily unavailable while looking up the session" into the same null as
  // "genuinely no valid session" (fine for its many other callers, which only ever
  // 401 either way). The admin API can't afford that ambiguity — a transient DB blip
  // must surface as retryable "unavailable", never as a false "unauthenticated" that
  // silently blocks a real admin's request, exactly like requireAdminForPage (the
  // cookie/web-page equivalent) already does.
  const bearer = extractBearerToken(request.headers.get("authorization"));
  const cookieToken = bearer ? null : readCookie(request.headers.get("cookie"), "session");
  const token = bearer ?? cookieToken;
  if (!token) return { status: "unauthenticated" };

  const sessionResult = await getUserForSessionToken(token);
  if (sessionResult.status === "unavailable") return { status: "unavailable", message: sessionResult.message };
  const user = sessionResult.data;
  if (!user) return { status: "unauthenticated" };

  const adminResult = await isUserAdmin(user.id);
  if (adminResult.status === "unavailable") return { status: "unavailable", message: adminResult.message };
  if (!adminResult.data) return { status: "forbidden" };

  return { status: "ok", user };
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/**
 * Reads the current session cookie for a customer-facing Server Component page (no admin
 * check) — same mechanism as requireAdminForPage below, just without the admin gate. Web
 * has no login page yet, so this returns null on every request today; it exists so
 * customer pages can honestly render "logged in" UI (e.g. the home page's account area)
 * the moment a real web login flow starts setting this cookie, without inventing a second
 * auth mechanism or fabricating a signed-in state in the meantime.
 */
export async function getCurrentUserForPage(): Promise<PublicUser | null> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  const token = store.get("session")?.value;
  if (!token) return null;

  const result = await getUserForSessionToken(token);
  return result.status === "ok" ? result.data : null;
}

/**
 * Same authorization as requireAdmin, for use in App Router Server Components (the admin
 * dashboard's pages), which don't have a raw Request to read headers from — only
 * next/headers' cookies(). There is only one session mechanism; this just reads it from a
 * different API surface. Never used by API routes — those call requireAdmin(request).
 */
export async function requireAdminForPage(): Promise<RequireAdminResult> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  const token = store.get("session")?.value;
  if (!token) return { status: "unauthenticated" };

  const sessionResult = await getUserForSessionToken(token);
  if (sessionResult.status === "unavailable") return { status: "unavailable", message: sessionResult.message };
  const user = sessionResult.data;
  if (!user) return { status: "unauthenticated" };

  const adminResult = await isUserAdmin(user.id);
  if (adminResult.status === "unavailable") return { status: "unavailable", message: adminResult.message };
  if (!adminResult.data) return { status: "forbidden" };

  return { status: "ok", user };
}
