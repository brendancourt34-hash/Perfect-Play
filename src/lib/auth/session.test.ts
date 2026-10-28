import { describe, expect, it } from "vitest";
import {
  extractBearerToken,
  generateSessionToken,
  hashSessionToken,
  isSessionExpired,
  sessionExpiresAt,
} from "./session";

describe("session tokens", () => {
  it("generates a unique token each time", () => {
    expect(generateSessionToken()).not.toBe(generateSessionToken());
  });

  it("hashes the same token identically every time (deterministic lookup)", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it("never stores the raw token as its own hash", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).not.toBe(token);
  });
});

describe("session expiry", () => {
  it("sets an expiry roughly 30 days in the future", () => {
    const from = new Date("2026-09-04T00:00:00Z");
    const expires = sessionExpiresAt(from);
    const daysDiff = (expires.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
    expect(daysDiff).toBeCloseTo(30, 0);
  });

  it("is not expired before its expiry time", () => {
    expect(isSessionExpired(new Date("2026-09-10T00:00:00Z"), new Date("2026-09-04T00:00:00Z"))).toBe(false);
  });

  it("is expired at or after its expiry time", () => {
    expect(isSessionExpired(new Date("2026-09-01T00:00:00Z"), new Date("2026-09-04T00:00:00Z"))).toBe(true);
    expect(isSessionExpired(new Date("2026-09-04T00:00:00Z"), new Date("2026-09-04T00:00:00Z"))).toBe(true);
  });
});

describe("extractBearerToken", () => {
  it("extracts the token from a valid Authorization header", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
  });

  it("is case-insensitive on the Bearer scheme", () => {
    expect(extractBearerToken("bearer abc123")).toBe("abc123");
  });

  it("returns null for a missing or malformed header", () => {
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken("")).toBeNull();
    expect(extractBearerToken("Basic abc123")).toBeNull();
  });
});
