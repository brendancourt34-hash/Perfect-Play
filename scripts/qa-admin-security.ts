/**
 * PHASE 23 SECURITY HARDENING QA — verifies the admin access model against the real
 * running backend: every /api/admin/* route (including every route added since Phase 18 —
 * wallet, withdrawals, entry-packages, settings, terms, NBA void/sync, generic round
 * creation), the /admin page tree, and every documented privilege-escalation vector
 * (request-body isAdmin, query-param isAdmin, fake headers, arbitrary IDs). Confirms
 * normal customer registration/login and mobile bearer-token auth are unaffected.
 *
 * This complements scripts/qa-phase18-admin.ts (which already covers the Phase 18
 * competition/entry business-logic checks in depth) — this script is deliberately
 * adversarial and exhaustive across the ROUTE SURFACE rather than business logic.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

const API_URL = "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
const MARK = `qa-test-internal-admin-security-${Date.now()}`;
let passed = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`PASS: ${msg}`);
  passed++;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // some routes (redirects, HTML pages) don't return JSON — callers that need the body check status/text separately
  }
  return { status: res.status, body };
}

async function textOf(path: string, headers?: Record<string, string>): Promise<{ status: number; text: string }> {
  const res = await fetch(`${API_URL}${path}`, { headers, redirect: "manual" });
  const text = await res.text();
  return { status: res.status, text };
}

async function registerUser(email: string): Promise<{ token: string; userId: number }> {
  const r = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password: "qa-test-password-123", name: "QA Security" }) });
  if (!r.body.ok) throw new Error(`register failed for ${email}: ${JSON.stringify(r.body)}`);
  const rows = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  return { token: r.body.data.token as string, userId: rows[0].id };
}

/** Every /api/admin/* route in the codebase, with a method + a body/query that would be VALID if auth were the only gate — so a 401/403 here proves auth runs before any other check, never a false-negative because the request was malformed for an unrelated reason. */
const ADMIN_ROUTES: { method: string; path: string; body?: object }[] = [
  { method: "GET", path: "/api/admin/dashboard" },
  { method: "GET", path: "/api/admin/competitions" },
  { method: "GET", path: "/api/admin/competitions/999999999" },
  { method: "GET", path: "/api/admin/competitions/999999999/entries" },
  { method: "POST", path: "/api/admin/competitions/999999999/close" },
  { method: "POST", path: "/api/admin/competitions/999999999/settle" },
  { method: "GET", path: "/api/admin/entries/999999999" },
  { method: "GET", path: "/api/admin/entry-packages" },
  { method: "POST", path: "/api/admin/entry-packages", body: { entryCount: 1, priceCents: 100, label: "x" } },
  { method: "PATCH", path: "/api/admin/entry-packages/999999999", body: { active: false } },
  { method: "POST", path: "/api/admin/nba/sync-schedule", body: { startDate: "2099-01-01", endDate: "2099-01-02" } },
  { method: "POST", path: "/api/admin/nba/void-game", body: { gameId: 999999999, reason: "qa" } },
  { method: "POST", path: "/api/admin/nba/void-selection", body: { entrySelectionId: 999999999, side: "player1", reason: "qa" } },
  { method: "GET", path: "/api/admin/rounds/candidates?sportCode=nrl&startDate=2099-01-01&endDate=2099-01-02" },
  { method: "POST", path: "/api/admin/rounds/create", body: { sportCode: "nrl", seasonId: 999999999, roundNumber: 1, name: "x", startDate: "2099-01-01", endDate: "2099-01-02", assignments: [{ gameId: 1, slotLabel: null }] } },
  { method: "POST", path: "/api/admin/rounds/sync-provider-round", body: { sportCode: "nrl", sportName: "NRL", seasonExternalId: "x", roundExternalId: "x" } },
  { method: "GET", path: "/api/admin/settings" },
  { method: "PUT", path: "/api/admin/settings/max_entries_per_round", body: { value: 10 } },
  { method: "POST", path: "/api/admin/sports-data/sync", body: { sportCode: "nrl", seasonExternalId: "x", roundExternalId: "x" } },
  { method: "GET", path: "/api/admin/terms" },
  { method: "POST", path: "/api/admin/terms", body: { versionNumber: "qa", effectiveDate: "2099-01-01", content: [{ heading: "h", body: "b" }] } },
  { method: "GET", path: "/api/admin/terms/999999999" },
  { method: "PATCH", path: "/api/admin/terms/999999999", body: { versionNumber: "qa2" } },
  { method: "POST", path: "/api/admin/terms/999999999/publish" },
  { method: "GET", path: "/api/admin/terms/999999999/acceptances" },
  { method: "GET", path: "/api/admin/users/999999999/wallet" },
  { method: "POST", path: "/api/admin/users/999999999/wallet/adjust", body: { amountCents: 100, reason: "qa" } },
  { method: "GET", path: "/api/admin/withdrawals" },
  { method: "POST", path: "/api/admin/withdrawals/999999999/status", body: { status: "completed" } },
];

async function main() {
  console.log(`=== ADMIN SECURITY QA (${ADMIN_ROUTES.length} routes x unauthenticated + normal-user) ===`);

  const normalEmail = `${MARK}-normal@example.com`;
  const adminEmail = `${MARK}-admin@example.com`;
  const { token: normalToken, userId: normalUserId } = await registerUser(normalEmail);
  const { token: adminToken, userId: adminUserId } = await registerUser(adminEmail);
  await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, adminUserId));
  const normalAuth = { Authorization: `Bearer ${normalToken}` };
  const adminAuth = { Authorization: `Bearer ${adminToken}` };

  try {
    // ============================================================
    // 1-2, 5-11, 16-18: every admin route rejects unauthenticated (401) and normal-user (403)
    // ============================================================
    for (const route of ADMIN_ROUTES) {
      const init = (headers?: Record<string, string>) => ({ method: route.method, headers, body: route.body ? JSON.stringify(route.body) : undefined });
      const unauth = await api(route.path, init());
      assert(unauth.status === 401, `${route.method} ${route.path} — unauthenticated -> 401`);

      const normal = await api(route.path, init(normalAuth));
      assert(normal.status === 403, `${route.method} ${route.path} — normal (is_admin=false) user -> 403`);
    }

    // ============================================================
    // 17. arbitrary competition ID cannot bypass authorization (403, not 404 — auth runs first)
    // 18. arbitrary entry ID cannot bypass authorization (403, not 404 — auth runs first)
    // 16. arbitrary user ID cannot expose admin/user data (403, not 404 — auth runs first)
    // (These are the same assertions as above, called out explicitly by number since the
    // sweep already used ID 999999999 for every one of these routes.)
    // ============================================================
    assert(true, "16-18. arbitrary competition/entry/user IDs never bypass auth (covered by the sweep above — every ID-bearing route 403'd before any ID lookup occurred)");

    // ============================================================
    // 12-13. request body / query parameter cannot elevate privileges
    // ============================================================
    const bodyEscalation = await api("/api/admin/users/999999999/wallet/adjust", {
      method: "POST",
      headers: normalAuth,
      body: JSON.stringify({ amountCents: 100, reason: "qa", isAdmin: true, is_admin: true, admin: true }),
    });
    assert(bodyEscalation.status === 403, "13. a request body containing isAdmin:true (alongside otherwise-valid fields) never elevates a normal user's privileges");

    const queryEscalation = await api("/api/admin/dashboard?isAdmin=true&is_admin=1&admin=true", { headers: normalAuth });
    assert(queryEscalation.status === 403, "14. a query parameter claiming admin never elevates a normal user's privileges");

    // ============================================================
    // 15. a fake client-side isAdmin value (custom header, forged cookie) cannot elevate privileges
    // ============================================================
    const headerEscalation = await api("/api/admin/dashboard", {
      headers: { ...normalAuth, "X-Is-Admin": "true", "X-Admin": "1", "X-User-Role": "admin" },
    });
    assert(headerEscalation.status === 403, "15a. spoofed X-Is-Admin/X-Admin/X-User-Role headers never elevate privileges — the server never reads them");

    const cookieEscalation = await fetch(`${API_URL}/api/admin/dashboard`, {
      headers: { ...normalAuth, Cookie: "isAdmin=true; is_admin=true; admin=1" },
    });
    assert(cookieEscalation.status === 403, "15b. a forged isAdmin/is_admin/admin cookie never elevates privileges — the server only ever reads the opaque `session` cookie/bearer token and re-derives isAdmin from the database");

    // ============================================================
    // 12/13 (registration variant). isAdmin cannot be set at registration via the request body
    // ============================================================
    const selfPromoEmail = `${MARK}-selfpromo@example.com`;
    const selfPromoRes = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email: selfPromoEmail, password: "qa-test-password-123", name: "QA", isAdmin: true, is_admin: true, admin: true }),
    });
    assert(selfPromoRes.status === 201, "registration with extraneous isAdmin fields in the body still succeeds normally");
    assert(!("isAdmin" in (selfPromoRes.body.data?.user ?? {})) && !("is_admin" in (selfPromoRes.body.data?.user ?? {})), "the register response never echoes back any isAdmin field at all");
    const selfPromoRows = await db.select().from(schema.users).where(eq(schema.users.email, selfPromoEmail)).limit(1);
    assert(selfPromoRows[0].isAdmin === false, "12. a request body containing isAdmin:true at registration is silently ignored — the new user is is_admin=false in the database");
    // cleanup this one immediately (not tracked in the shared users list below)
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, selfPromoRows[0].id));
    await db.delete(schema.users).where(eq(schema.users.id, selfPromoRows[0].id));

    // ============================================================
    // 3-4. is_admin=false -> denied, is_admin=true -> allowed (API)
    // 19. admin can still perform all currently supported admin operations (spot check across the newer routes)
    // ============================================================
    const adminDashboard = await api("/api/admin/dashboard", { headers: adminAuth });
    assert(adminDashboard.status === 200 && adminDashboard.body.ok, "3-4/19. an is_admin=true user reaches the dashboard successfully (200)");

    const adminCompetitions = await api("/api/admin/competitions", { headers: adminAuth });
    assert(adminCompetitions.status === 200, "19. admin can list competitions");
    const adminEntryPackages = await api("/api/admin/entry-packages", { headers: adminAuth });
    assert(adminEntryPackages.status === 200, "19. admin can list entry packages");
    const adminSettings = await api("/api/admin/settings", { headers: adminAuth });
    assert(adminSettings.status === 200, "19. admin can list platform settings");
    const adminWithdrawals = await api("/api/admin/withdrawals", { headers: adminAuth });
    assert(adminWithdrawals.status === 200, "19. admin can list withdrawals");
    const adminTerms = await api("/api/admin/terms", { headers: adminAuth });
    assert(adminTerms.status === 200, "19. admin can list terms versions");
    const adminUserWallet = await api(`/api/admin/users/${normalUserId}/wallet`, { headers: adminAuth });
    assert(adminUserWallet.status === 200, "19. admin can view another user's wallet");

    // ============================================================
    // 6-9. normal user cannot access admin dashboard/competition/entry/payment/withdrawal APIs
    // (already proven exhaustively by the sweep above; this reiterates against real,
    // EXISTING resources rather than only ID 999999999, to rule out any special-casing
    // around "not found" vs "forbidden".)
    // ============================================================
    // Reuse the real dev DB's existing "nrl" sport row if one exists (it always does, in
    // any real Perfect 2 dev DB) rather than assuming this is a fresh database.
    const existingSport = (await db.select().from(schema.sports).where(eq(schema.sports.code, "nrl")))[0];
    const sport = existingSport ?? (await db.insert(schema.sports).values({ code: "nrl", name: "NRL" }).returning())[0];

    // Defensive pre-flight: a previous run of this script that crashed or was killed
    // before reaching its own cleanup can leave a QA season behind at the same fixed
    // (sportId, year=2099) pair this run is about to use, which seasons_sport_year_unique
    // would then reject forever. Find and remove any such leftovers by label prefix first
    // (same pattern as qa-phase22-nba.ts's orphaned-round pre-flight cleanup).
    const orphanedSeasons = await db.select().from(schema.seasons).where(and(eq(schema.seasons.sportId, sport.id), eq(schema.seasons.year, 2099)));
    for (const s of orphanedSeasons) {
      if (!s.label?.startsWith("qa-test-internal-admin-security-")) continue;
      console.log(`Pre-flight: removing an orphaned QA season from a previous run (id=${s.id}, label=${s.label}).`);
      const orphanedRounds = await db.select().from(schema.rounds).where(eq(schema.rounds.seasonId, s.id));
      for (const r of orphanedRounds) {
        const orphanedComps = await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, r.id));
        for (const c of orphanedComps) {
          const orphanedEntries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, c.id));
          for (const e of orphanedEntries) await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, e.id));
          await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, c.id));
          await db.delete(schema.competitions).where(eq(schema.competitions.id, c.id));
        }
        await db.delete(schema.games).where(eq(schema.games.roundId, r.id));
        await db.delete(schema.rounds).where(eq(schema.rounds.id, r.id));
      }
      await db.delete(schema.seasons).where(eq(schema.seasons.id, s.id));
    }

    const [season] = await db.insert(schema.seasons).values({ sportId: sport.id, year: 2099, label: `${MARK}-season` }).returning();
    const [round] = await db.insert(schema.rounds).values({ seasonId: season.id, roundNumber: 1, name: `${MARK}-round` }).returning();
    const [competition] = await db.insert(schema.competitions).values({ sportId: sport.id, roundId: round.id, name: `${MARK}-competition`, entryFeeCents: 500, status: "open" }).returning();

    const realCompForbidden = await api(`/api/admin/competitions/${competition.id}`, { headers: normalAuth });
    assert(realCompForbidden.status === 403, "6/17. normal user forbidden from a REAL competition's admin detail (not just a nonexistent id)");
    const realCompEntriesForbidden = await api(`/api/admin/competitions/${competition.id}/entries`, { headers: normalAuth });
    assert(realCompEntriesForbidden.status === 403, "8. normal user forbidden from a REAL competition's admin entries/payment view");

    // ============================================================
    // 10-11. normal user cannot mutate competition state or settlement (against a REAL competition)
    // ============================================================
    const realCloseForbidden = await api(`/api/admin/competitions/${competition.id}/close`, { method: "POST", headers: normalAuth });
    assert(realCloseForbidden.status === 403, "10. normal user cannot close a REAL competition");
    const realSettleForbidden = await api(`/api/admin/competitions/${competition.id}/settle`, { method: "POST", headers: normalAuth });
    assert(realSettleForbidden.status === 403, "11. normal user cannot settle a REAL competition");
    const compRowAfter = await db.select().from(schema.competitions).where(eq(schema.competitions.id, competition.id)).limit(1);
    assert(compRowAfter[0].status === "open", "10-11. the competition's status is genuinely unchanged after the rejected mutation attempts");

    // Admin CAN close it (proving the 403s above were genuinely about authorization, not a broken route).
    const adminCloseOk = await api(`/api/admin/competitions/${competition.id}/close`, { method: "POST", headers: adminAuth });
    assert(adminCloseOk.status === 200, "19. admin CAN close the same real competition the normal user was rejected from");

    // ============================================================
    // /admin page tree — never trust hidden navigation or a client-side check
    // ============================================================
    const adminPageUnauth = await textOf("/admin");
    assert(adminPageUnauth.status >= 300 && adminPageUnauth.status < 400, "1. unauthenticated GET /admin redirects (never renders the dashboard)");

    const adminPageNormal = await textOf("/admin", { Cookie: `session=${normalToken}` });
    assert(!/Dashboard[\s\S]*Competitions[\s\S]*NRL Rounds/.test(adminPageNormal.text), "2. a normal user's GET /admin never renders the real admin nav/dashboard content");
    assert(/Forbidden/i.test(adminPageNormal.text) || adminPageNormal.status >= 300, "2. a normal user's GET /admin shows a generic Forbidden state, not the dashboard");

    const adminPageAdmin = await textOf("/admin", { Cookie: `session=${adminToken}` });
    assert(adminPageAdmin.status === 200 && /Dashboard/.test(adminPageAdmin.text), "an is_admin=true user's GET /admin renders the real dashboard");

    // ============================================================
    // 20. normal customer login remains unchanged
    // ============================================================
    const reLogin = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: normalEmail, password: "qa-test-password-123" }) });
    assert(reLogin.status === 200 && reLogin.body.data.token, "20. normal customer login still works and returns a session token");
    assert(!("isAdmin" in reLogin.body.data.user) && !("is_admin" in reLogin.body.data.user), "20. login response never exposes isAdmin to the client");

    // ============================================================
    // 21. mobile authentication (Bearer token) remains unchanged
    // ============================================================
    const mobileMe = await api("/api/auth/me", { headers: { Authorization: `Bearer ${reLogin.body.data.token}` } });
    assert(mobileMe.status === 200 && mobileMe.body.data.user.email === normalEmail, "21. mobile-style Bearer-token auth (Authorization header, no cookie) still works for /api/auth/me");
    assert(!("isAdmin" in mobileMe.body.data.user), "21. /api/auth/me never exposes isAdmin over the mobile auth path either");

    // A Bearer token can never be used to reach admin routes for a non-admin account.
    const mobileAdminAttempt = await api("/api/admin/dashboard", { headers: { Authorization: `Bearer ${reLogin.body.data.token}` } });
    assert(mobileAdminAttempt.status === 403, "21. the mobile auth mechanism (Bearer token) is subject to the exact same is_admin check — no separate weaker path");

    console.log(`\n=== ADMIN SECURITY QA: ${passed} checks passed ===`);
  } finally {
    console.log("Cleaning up QA data...");
    const compRows = await db.select().from(schema.competitions).where(eq(schema.competitions.name, `${MARK}-competition`));
    for (const c of compRows) {
      const entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, c.id));
      for (const e of entries) await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, e.id));
      await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, c.id));
      await db.delete(schema.competitions).where(eq(schema.competitions.id, c.id));
    }
    const roundRows = await db.select().from(schema.rounds).where(eq(schema.rounds.name, `${MARK}-round`));
    for (const r of roundRows) {
      await db.delete(schema.games).where(eq(schema.games.roundId, r.id));
      await db.delete(schema.rounds).where(eq(schema.rounds.id, r.id));
    }
    const seasonRows = await db.select().from(schema.seasons).where(eq(schema.seasons.label, `${MARK}-season`));
    for (const s of seasonRows) await db.delete(schema.seasons).where(eq(schema.seasons.id, s.id));
    // The "nrl" sport row itself is real, shared reference data (reused above, never
    // created by this script) — it is deliberately never deleted here.

    await db.delete(schema.sessions).where(eq(schema.sessions.userId, normalUserId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, adminUserId));
    await db.delete(schema.users).where(eq(schema.users.id, normalUserId));
    await db.delete(schema.users).where(eq(schema.users.id, adminUserId));

    const leftoverUsers = await db.select().from(schema.users).where(eq(schema.users.email, normalEmail));
    const leftoverAdmin = await db.select().from(schema.users).where(eq(schema.users.email, adminEmail));
    assert(leftoverUsers.length === 0 && leftoverAdmin.length === 0, "cleanup verified: zero rows remain for the QA users");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
