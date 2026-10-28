import { describe, expect, it } from "vitest";
import { isAuthorizedCronRequest } from "./cron";

function requestWithAuth(header: string | null): Request {
  const headers = new Headers();
  if (header !== null) headers.set("authorization", header);
  return new Request("http://localhost/api/admin/notifications/tick", { headers });
}

describe("isAuthorizedCronRequest", () => {
  it("rejects every request when CRON_SECRET is not configured — never 'anything goes' on an unset secret", () => {
    expect(isAuthorizedCronRequest(requestWithAuth("Bearer whatever"), undefined)).toBe(false);
    expect(isAuthorizedCronRequest(requestWithAuth("Bearer whatever"), "")).toBe(false);
  });

  it("accepts the exact configured secret as a Bearer token", () => {
    expect(isAuthorizedCronRequest(requestWithAuth("Bearer my-cron-secret-123"), "my-cron-secret-123")).toBe(true);
  });

  it("rejects a missing Authorization header", () => {
    expect(isAuthorizedCronRequest(requestWithAuth(null), "my-cron-secret-123")).toBe(false);
  });

  it("rejects a non-Bearer Authorization header", () => {
    expect(isAuthorizedCronRequest(requestWithAuth("Basic my-cron-secret-123"), "my-cron-secret-123")).toBe(false);
  });

  it("rejects an incorrect secret", () => {
    expect(isAuthorizedCronRequest(requestWithAuth("Bearer wrong-secret"), "my-cron-secret-123")).toBe(false);
  });

  it("rejects a secret that is a prefix/suffix of the real one (length mismatch)", () => {
    expect(isAuthorizedCronRequest(requestWithAuth("Bearer my-cron-secret"), "my-cron-secret-123")).toBe(false);
    expect(isAuthorizedCronRequest(requestWithAuth("Bearer my-cron-secret-1234"), "my-cron-secret-123")).toBe(false);
  });

  it("is case-sensitive on the secret itself", () => {
    expect(isAuthorizedCronRequest(requestWithAuth("Bearer MY-CRON-SECRET-123"), "my-cron-secret-123")).toBe(false);
  });
});
