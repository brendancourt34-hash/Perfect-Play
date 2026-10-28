import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { hashPassword, normalizeAndValidateEmail, validatePasswordStrength, verifyPassword } from "@/lib/auth/password";
import { generateSessionToken, hashSessionToken, isSessionExpired, sessionExpiresAt } from "@/lib/auth/session";
import { safeQuery, type DataResult } from "./result";

export type PublicUser = { id: number; email: string; name: string | null };

function toPublicUser(user: typeof schema.users.$inferSelect): PublicUser {
  return { id: user.id, email: user.email, name: user.name };
}

export type RegisterResult =
  | { status: "ok"; user: PublicUser; token: string }
  | { status: "invalid"; errors: string[] }
  | { status: "unavailable"; message: string };

/** Registers a new first-party account and returns a fresh session token, same as login. */
export async function registerUser(email: string, password: string, name: string): Promise<RegisterResult> {
  const emailCheck = normalizeAndValidateEmail(email);
  if (!emailCheck.valid) return { status: "invalid", errors: emailCheck.errors };
  const normalizedEmail = emailCheck.email;

  const passwordCheck = validatePasswordStrength(password);
  if (!passwordCheck.valid) return { status: "invalid", errors: passwordCheck.errors };

  const db = getDb();
  try {
    const existing = await db.select().from(schema.users).where(eq(schema.users.email, normalizedEmail)).limit(1);
    if (existing[0]) return { status: "invalid", errors: ["An account with this email already exists."] };

    const [user] = await db
      .insert(schema.users)
      .values({ email: normalizedEmail, name: name.trim() || null, passwordHash: hashPassword(password) })
      .returning();

    const token = await issueSession(user.id);
    return { status: "ok", user: toPublicUser(user), token };
  } catch (error) {
    return { status: "unavailable", message: error instanceof Error ? error.message : "Unknown error." };
  }
}

export type LoginResult =
  | { status: "ok"; user: PublicUser; token: string }
  | { status: "invalid"; errors: string[] }
  | { status: "unavailable"; message: string };

export async function loginUser(email: string, password: string): Promise<LoginResult> {
  const db = getDb();
  try {
    const rows = await db.select().from(schema.users).where(eq(schema.users.email, email.trim().toLowerCase())).limit(1);
    const user = rows[0];
    // Deliberately identical error for "no such user" and "wrong password" — never reveal
    // which one it was, that leaks whether an email is registered.
    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      return { status: "invalid", errors: ["Incorrect email or password."] };
    }
    const token = await issueSession(user.id);
    return { status: "ok", user: toPublicUser(user), token };
  } catch (error) {
    return { status: "unavailable", message: error instanceof Error ? error.message : "Unknown error." };
  }
}

async function issueSession(userId: number): Promise<string> {
  const db = getDb();
  const token = generateSessionToken();
  await db.insert(schema.sessions).values({ userId, tokenHash: hashSessionToken(token), expiresAt: sessionExpiresAt() });
  return token;
}

/** Verifies a bearer token and returns the user it belongs to, or null if invalid/expired. */
export async function getUserForSessionToken(token: string): Promise<DataResult<PublicUser | null>> {
  return safeQuery(async () => {
    const db = getDb();
    const tokenHash = hashSessionToken(token);
    const sessionRows = await db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, tokenHash)).limit(1);
    const session = sessionRows[0];
    if (!session || isSessionExpired(session.expiresAt)) return null;

    const userRows = await db.select().from(schema.users).where(eq(schema.users.id, session.userId)).limit(1);
    return userRows[0] ? toPublicUser(userRows[0]) : null;
  });
}

export async function revokeSessionToken(token: string): Promise<DataResult<void>> {
  return safeQuery(async () => {
    await getDb().delete(schema.sessions).where(eq(schema.sessions.tokenHash, hashSessionToken(token)));
  });
}

/**
 * Deliberately separate from PublicUser/toPublicUser above — isAdmin is never included in
 * anything returned to a client (mobile's /api/auth/me, register, login all stay exactly
 * as they were). Only the admin-authorization check (src/lib/auth/require.ts) calls this.
 */
export async function isUserAdmin(userId: number): Promise<DataResult<boolean>> {
  return safeQuery(async () => {
    const rows = await getDb().select({ isAdmin: schema.users.isAdmin }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    return rows[0]?.isAdmin ?? false;
  });
}
