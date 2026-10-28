import { timingSafeEqual } from "node:crypto";
import { extractBearerToken } from "./session";

/**
 * Authorizes a production-scheduler request (Vercel Cron) — a SEPARATE mechanism from
 * requireAdmin's session-cookie/bearer-token auth, because a scheduled job has no user
 * session to present. Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically
 * once the `CRON_SECRET` environment variable is configured on the project (Vercel's own
 * documented convention — Vercel does not verify this itself, the route must). Closed by
 * default: with no CRON_SECRET configured, this always returns false, never treating an
 * unset secret as "anything goes."
 *
 * Reuses the exact same bearer-token parsing as every other auth path in this codebase
 * (extractBearerToken, src/lib/auth/session.ts) — no second parsing scheme.
 */
export function isAuthorizedCronRequest(request: Request, cronSecret: string | undefined): boolean {
  if (!cronSecret) return false;
  const provided = extractBearerToken(request.headers.get("authorization"));
  if (!provided) return false;

  // Constant-time comparison — this is a bearer secret, not a public value, so a
  // length/content-dependent early-exit comparison (`===`) would leak timing information
  // an attacker could use to guess it byte-by-byte. Both buffers must be equal length for
  // timingSafeEqual itself to run; a length mismatch is handled (and safely rejected)
  // before ever calling it.
  const providedBuf = Buffer.from(provided);
  const secretBuf = Buffer.from(cronSecret);
  if (providedBuf.length !== secretBuf.length) return false;
  return timingSafeEqual(providedBuf, secretBuf);
}
