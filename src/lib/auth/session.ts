import { createHash, randomBytes } from "node:crypto";

/**
 * Opaque bearer session tokens — the same mechanism serves both the web app (as an
 * httpOnly cookie) and the mobile app (as an `Authorization: Bearer <token>` header). The
 * raw token is only ever shown to the client once, at login; the database stores nothing
 * but its SHA-256 hash, so a database read alone can never be replayed as a working
 * session token.
 */

export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + SESSION_DURATION_MS);
}

export function isSessionExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/** Extracts a bearer token from a standard `Authorization: Bearer <token>` header value. */
export function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  return match ? match[1] : null;
}
