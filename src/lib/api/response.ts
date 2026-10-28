import { NextResponse } from "next/server";

/** Consistent JSON envelope for the mobile/API boundary — never leaks raw DB errors. */
export function apiOk<T>(data: T, init?: number) {
  return NextResponse.json({ ok: true, data }, { status: init ?? 200 });
}

export function apiError(status: number, message: string, errors?: string[]) {
  return NextResponse.json({ ok: false, message, errors }, { status });
}

export const apiUnauthorized = () => apiError(401, "Authentication required.");
export const apiForbidden = () => apiError(403, "You don't have permission to do that.");
export const apiNotFound = (what: string) => apiError(404, `${what} not found.`);
export const apiUnavailable = () => apiError(503, "Data is temporarily unavailable. Try again shortly.");
