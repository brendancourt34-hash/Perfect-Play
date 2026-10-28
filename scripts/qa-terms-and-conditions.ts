/**
 * PHASE 23 QA — Terms & Conditions system, against the real running backend. Exercises
 * the public terms endpoint, the acceptance flow, and the full admin
 * create-draft -> edit -> publish -> supersede lifecycle. Whatever real version is
 * currently published (seed-terms-v1.ts / seed-terms-v2.ts / any later admin-published
 * version) is genuine reference content, not a QA fixture — this script reads whichever
 * one is actually live rather than hardcoding a version number, creates its own
 * throwaway QA version to test publishing/superseding, and deletes ONLY that QA version
 * plus its own QA user/acceptance rows afterward, exactly as qa-phase22-nba.ts
 * deliberately does not delete real synced reference data.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

const API_URL = "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
const MARK = `qa-test-internal-terms-${Date.now()}`;
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

async function registerUser(email: string) {
  const res = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password: "qa-test-password-123", name: "QA Terms" }) });
  if (!res.body.ok) throw new Error(`register failed for ${email}: ${JSON.stringify(res.body)}`);
  return res.body.data.token as string;
}

async function main() {
  console.log("=== PHASE 23 QA: Terms & Conditions ===");

  const userEmail = `${MARK}-user@example.com`;
  const adminEmail = `${MARK}-admin@example.com`;
  const userToken = await registerUser(userEmail);
  const adminToken = await registerUser(adminEmail);
  const userAuth = { Authorization: `Bearer ${userToken}` };
  const adminAuth = { Authorization: `Bearer ${adminToken}` };

  const userRows = await db.select().from(schema.users).where(eq(schema.users.email, userEmail)).limit(1);
  const adminRows = await db.select().from(schema.users).where(eq(schema.users.email, adminEmail)).limit(1);
  const userId = userRows[0].id;
  const adminId = adminRows[0].id;
  await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, adminId));

  let draftId: number | null = null;
  let v1Id = -1;
  let realPublishedVersionNumber = "";
  try {
    // --- Public terms + acceptance flow (whichever real version is currently published) ---
    const publicTermsRes = await api("/api/terms");
    assert(publicTermsRes.status === 200, "GET /api/terms (public, no auth) succeeds");
    assert(typeof publicTermsRes.body.data.terms.versionNumber === "string" && publicTermsRes.body.data.terms.versionNumber.length > 0, "the currently published version has a real version number");
    v1Id = publicTermsRes.body.data.terms.id;
    realPublishedVersionNumber = publicTermsRes.body.data.terms.versionNumber as string;
    assert(Array.isArray(publicTermsRes.body.data.terms.content) && publicTermsRes.body.data.terms.content.length > 0, "the published terms have real structured sections");

    const beforeAcceptRes = await api("/api/me/terms-acceptance", { headers: userAuth });
    assert(beforeAcceptRes.status === 200 && beforeAcceptRes.body.data.accepted === false, "a new user has not yet accepted the current terms");

    const staleAcceptRes = await api("/api/me/terms-acceptance", { method: "POST", headers: userAuth, body: JSON.stringify({ termsVersionId: 999999 }) });
    assert(staleAcceptRes.status === 409, "accepting a version id that isn't the currently published one is rejected");

    const acceptRes = await api("/api/me/terms-acceptance", { method: "POST", headers: userAuth, body: JSON.stringify({ termsVersionId: v1Id }) });
    assert(acceptRes.status === 201 && acceptRes.body.data.accepted === true, "accepting the current version succeeds");

    const doubleAcceptRes = await api("/api/me/terms-acceptance", { method: "POST", headers: userAuth, body: JSON.stringify({ termsVersionId: v1Id }) });
    assert(doubleAcceptRes.status === 201, "accepting the same version twice is a safe idempotent no-op, not an error");

    const acceptanceRows = await db.select().from(schema.termsAcceptances).where(eq(schema.termsAcceptances.userId, userId));
    assert(acceptanceRows.length === 1, "double-accepting never created a duplicate acceptance row");

    const afterAcceptRes = await api("/api/me/terms-acceptance", { headers: userAuth });
    assert(afterAcceptRes.body.data.accepted === true, "the user now shows as having accepted the current terms");

    // --- Admin permission boundary ---
    const nonAdminListRes = await api("/api/admin/terms", { headers: userAuth });
    assert(nonAdminListRes.status === 403, "a non-admin cannot list admin terms versions");

    const adminListRes = await api("/api/admin/terms", { headers: adminAuth });
    assert(adminListRes.status === 200 && adminListRes.body.data.versions.some((v: { id: number }) => v.id === v1Id), `admin can list all versions, including the real published ${realPublishedVersionNumber}`);

    // --- Admin draft -> edit -> publish -> supersede lifecycle (QA's own throwaway version) ---
    const createRes = await api("/api/admin/terms", {
      method: "POST",
      headers: adminAuth,
      body: JSON.stringify({
        versionNumber: `qa-${Date.now()}`.slice(0, 32),
        effectiveDate: "2099-01-01",
        content: [{ heading: "QA Section", body: "QA body text." }],
      }),
    });
    assert(createRes.status === 201 && createRes.body.data.version.status === "draft", "admin creates a new draft version");
    draftId = createRes.body.data.version.id;

    const stillV1Res = await api("/api/terms");
    assert(stillV1Res.body.data.terms.id === v1Id, "creating a draft never changes what's currently published");

    const editRes = await api(`/api/admin/terms/${draftId}`, {
      method: "PATCH",
      headers: adminAuth,
      body: JSON.stringify({ content: [{ heading: "QA Section (edited)", body: "QA body text, edited." }] }),
    });
    assert(editRes.status === 200 && editRes.body.data.version.content[0].heading === "QA Section (edited)", "admin can edit a draft's content");

    const publishRes = await api(`/api/admin/terms/${draftId}/publish`, { method: "POST", headers: adminAuth });
    assert(publishRes.status === 200 && publishRes.body.data.version.status === "published", "admin publishes the draft");

    const afterPublishRes = await api("/api/terms");
    assert(afterPublishRes.body.data.terms.id === draftId, "the public endpoint now serves the newly published version");

    const v1RowAfter = await db.select().from(schema.termsVersions).where(eq(schema.termsVersions.id, v1Id)).limit(1);
    assert(v1RowAfter[0].status === "archived", `publishing a new version automatically archives the previously published one (${realPublishedVersionNumber})`);

    const editAfterPublishRes = await api(`/api/admin/terms/${draftId}`, { method: "PATCH", headers: adminAuth, body: JSON.stringify({ content: [{ heading: "x", body: "y" }] }) });
    assert(editAfterPublishRes.status === 422, "a published version can never be edited again — immutable once published");

    const republishRes = await api(`/api/admin/terms/${draftId}/publish`, { method: "POST", headers: adminAuth });
    assert(republishRes.status === 422, "an already-published version cannot be republished");

    // --- Superseded acceptance ---
    const afterSupersedeRes = await api("/api/me/terms-acceptance", { headers: userAuth });
    assert(afterSupersedeRes.body.data.accepted === false, `accepting ${realPublishedVersionNumber} does NOT count once a new version is published — must accept again`);
    assert(afterSupersedeRes.body.data.currentVersion.id === draftId, `the current version now points at the QA version, not ${realPublishedVersionNumber}`);

    const stillOldVersionAcceptRes = await api("/api/me/terms-acceptance", { method: "POST", headers: userAuth, body: JSON.stringify({ termsVersionId: v1Id }) });
    assert(stillOldVersionAcceptRes.status === 409, `attempting to accept the now-archived ${realPublishedVersionNumber} is rejected — only the current version can be accepted`);

    const acceptNewRes = await api("/api/me/terms-acceptance", { method: "POST", headers: userAuth, body: JSON.stringify({ termsVersionId: draftId }) });
    assert(acceptNewRes.status === 201, "the user accepts the new current version");

    // --- Historical acceptance preserved + admin acceptance audit ---
    const v1AcceptancesRes = await api(`/api/admin/terms/${v1Id}/acceptances`, { headers: adminAuth });
    assert(v1AcceptancesRes.status === 200 && v1AcceptancesRes.body.data.acceptances.some((a: { userId: number }) => a.userId === userId), "the user's historical acceptance of v1.0 is preserved even after it's archived");

    const newAcceptancesRes = await api(`/api/admin/terms/${draftId}/acceptances`, { headers: adminAuth });
    assert(newAcceptancesRes.body.data.acceptances.some((a: { userId: number }) => a.userId === userId), "the user's acceptance of the new version is also recorded");

    console.log(`\n=== TERMS QA: ${passed} checks passed ===`);
  } finally {
    console.log(`Cleaning up QA data (leaving the real ${realPublishedVersionNumber} content untouched)...`);
    await db.delete(schema.termsAcceptances).where(eq(schema.termsAcceptances.userId, userId));
    if (draftId) await db.delete(schema.termsVersions).where(eq(schema.termsVersions.id, draftId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, adminId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.delete(schema.users).where(eq(schema.users.id, adminId));

    // Restore whichever version was REALLY published before this script ran (captured by
    // ID as v1Id above) — never a hardcoded version number. The QA version's own publish
    // archived it; nothing about its content was altered.
    if (v1Id >= 0) {
      const v1Rows = await db.select().from(schema.termsVersions).where(eq(schema.termsVersions.id, v1Id)).limit(1);
      if (v1Rows[0] && v1Rows[0].status === "archived") {
        await db.update(schema.termsVersions).set({ status: "published" }).where(eq(schema.termsVersions.id, v1Id));
        console.log(`Restored the real ${realPublishedVersionNumber} terms to 'published' status.`);
      }
    }

    const leftoverDraft = draftId ? await db.select().from(schema.termsVersions).where(eq(schema.termsVersions.id, draftId)) : [];
    const leftoverUser = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    assert(leftoverDraft.length === 0 && leftoverUser.length === 0, "cleanup verified: zero rows remain for QA-created fixtures");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
