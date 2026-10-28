import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * First-party password hashing using Node's built-in `scrypt` — no external dependency,
 * no third-party service, no invented credentials. A random 16-byte salt is generated per
 * password and stored alongside the hash as `salt:hash` (both hex), so no two users ever
 * share a salt even if they pick the same password.
 */

const KEY_LENGTH = 64;

export function hashPassword(plaintext: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(plaintext, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${derived}`;
}

/** Constant-time comparison — never use `===` on secrets, even hashed ones. */
export function verifyPassword(plaintext: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const derived = scryptSync(plaintext, salt, KEY_LENGTH);
  const stored = Buffer.from(hash, "hex");
  if (derived.length !== stored.length) return false;
  return timingSafeEqual(derived, stored);
}

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

/** Minimal, honest password policy — not a substitute for a real account-security review. */
export function validatePasswordStrength(plaintext: string): PasswordValidationResult {
  const errors: string[] = [];
  if (plaintext.length < 8) errors.push("Password must be at least 8 characters.");
  if (plaintext.length > 200) errors.push("Password is too long.");
  return { valid: errors.length === 0, errors };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalizes (trim + lowercase) and validates an email address's shape. */
export function normalizeAndValidateEmail(rawEmail: string): { valid: true; email: string } | { valid: false; errors: string[] } {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) {
    return { valid: false, errors: ["Enter a valid email address."] };
  }
  return { valid: true, email };
}
