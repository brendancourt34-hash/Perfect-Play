/**
 * Quick smoke test for the Phase 23 admin settings endpoints (max-entries-per-round +
 * entry-packages CRUD) against the real running backend. Creates one throwaway admin
 * user, exercises GET/PUT/POST/PATCH, restores the original max-entries value, then
 * deletes everything it created.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

const API_URL = "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
let passed = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`PASS: ${msg}`);
  passed++;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json();
  return { status: res.status, body };
}

async function main() {
  console.log("=== ADMIN SETTINGS SMOKE ===");
  const email = `qa-admin-settings-smoke-${Date.now()}@example.com`;
  const registerRes = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password: "qa-test-password-123", name: "QA Admin" }) });
  const token = registerRes.body.data.token as string;
  const userRows = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  const userId = userRows[0].id;
  await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, userId));
  const auth = { Authorization: `Bearer ${token}` };

  let createdPackageId: number | null = null;
  try {
    const originalSettingsRes = await api("/api/admin/settings", { headers: auth });
    assert(originalSettingsRes.status === 200, "GET /api/admin/settings succeeds for an admin");
    const originalMax = originalSettingsRes.body.data.settings.find((s: { key: string }) => s.key === "max_entries_per_round")?.value ?? 10;

    const nonAdminRes = await api("/api/entry-packages");
    assert(nonAdminRes.status === 200, "sanity: public entry-packages endpoint is unaffected");

    const forbiddenRes = await api("/api/admin/settings");
    assert(forbiddenRes.status === 401, "GET /api/admin/settings without auth is rejected with 401");

    const putRes = await api("/api/admin/settings/max_entries_per_round", { method: "PUT", headers: auth, body: JSON.stringify({ value: 7 }) });
    assert(putRes.status === 200 && putRes.body.data.setting.value === 7, "PUT max_entries_per_round updates the value");

    const afterPutRes = await api("/api/admin/settings", { headers: auth });
    assert(afterPutRes.body.data.settings.find((s: { key: string }) => s.key === "max_entries_per_round").value === 7, "the new value is reflected on read");

    const badKeyRes = await api("/api/admin/settings/not_a_real_key", { method: "PUT", headers: auth, body: JSON.stringify({ value: 1 }) });
    assert(badKeyRes.status === 404, "writing an unknown settings key is rejected");

    const createRes = await api("/api/admin/entry-packages", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ entryCount: 3, priceCents: 1200, label: "QA 3 Entries", badge: "TEST" }),
    });
    assert(createRes.status === 201, "POST /api/admin/entry-packages creates a new package");
    createdPackageId = createRes.body.data.package.id;

    const listRes = await api("/api/admin/entry-packages", { headers: auth });
    assert(listRes.body.data.packages.some((p: { id: number }) => p.id === createdPackageId), "the new package appears in the admin list");

    const publicListRes = await api("/api/entry-packages");
    assert(publicListRes.body.data.packages.some((p: { id: number }) => p.id === createdPackageId), "the new active package appears in the public list too");

    const deactivateRes = await api(`/api/admin/entry-packages/${createdPackageId}`, { method: "PATCH", headers: auth, body: JSON.stringify({ active: false }) });
    assert(deactivateRes.status === 200 && deactivateRes.body.data.package.active === false, "PATCH deactivates the package");

    const publicListAfterRes = await api("/api/entry-packages");
    assert(!publicListAfterRes.body.data.packages.some((p: { id: number }) => p.id === createdPackageId), "a deactivated package disappears from the public list");

    // Restore the original max-entries value so this smoke test never leaves platform state changed.
    const restoreRes = await api("/api/admin/settings/max_entries_per_round", { method: "PUT", headers: auth, body: JSON.stringify({ value: originalMax }) });
    assert(restoreRes.body.data.setting.value === originalMax, "original max_entries_per_round value restored");

    console.log(`\n=== ADMIN SETTINGS SMOKE: ${passed} checks passed ===`);
  } finally {
    console.log("Cleaning up QA data...");
    if (createdPackageId) await db.delete(schema.entryPackages).where(eq(schema.entryPackages.id, createdPackageId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    const leftoverUser = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    assert(leftoverUser.length === 0, "cleanup verified: zero rows remain for the QA admin user");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
