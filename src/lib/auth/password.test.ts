import { describe, expect, it } from "vitest";
import { hashPassword, normalizeAndValidateEmail, validatePasswordStrength, verifyPassword } from "./password";

describe("hashPassword / verifyPassword", () => {
  it("verifies the correct password against its own hash", () => {
    const hash = hashPassword("correct-horse-battery-staple");
    expect(verifyPassword("correct-horse-battery-staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", () => {
    const hash = hashPassword("correct-horse-battery-staple");
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("never stores the plaintext password in the hash", () => {
    const hash = hashPassword("my-secret-password");
    expect(hash).not.toContain("my-secret-password");
  });

  it("produces a different hash each time (random salt), even for the same password", () => {
    const hash1 = hashPassword("same-password");
    const hash2 = hashPassword("same-password");
    expect(hash1).not.toBe(hash2);
    expect(verifyPassword("same-password", hash1)).toBe(true);
    expect(verifyPassword("same-password", hash2)).toBe(true);
  });

  it("rejects a malformed stored hash rather than throwing", () => {
    expect(verifyPassword("anything", "not-a-valid-hash")).toBe(false);
    expect(verifyPassword("anything", "")).toBe(false);
  });
});

describe("validatePasswordStrength", () => {
  it("rejects passwords shorter than 8 characters", () => {
    expect(validatePasswordStrength("short").valid).toBe(false);
  });

  it("accepts a reasonable password", () => {
    expect(validatePasswordStrength("a-decent-password").valid).toBe(true);
  });
});

describe("normalizeAndValidateEmail", () => {
  it("accepts a well-formed email", () => {
    const result = normalizeAndValidateEmail("Player@Example.com");
    expect(result).toEqual({ valid: true, email: "player@example.com" });
  });

  it("trims whitespace and lowercases", () => {
    const result = normalizeAndValidateEmail("  Player@Example.COM  ");
    expect(result).toEqual({ valid: true, email: "player@example.com" });
  });

  it("rejects an empty or malformed email", () => {
    expect(normalizeAndValidateEmail("").valid).toBe(false);
    expect(normalizeAndValidateEmail("not-an-email").valid).toBe(false);
    expect(normalizeAndValidateEmail("missing-domain@").valid).toBe(false);
  });
});
