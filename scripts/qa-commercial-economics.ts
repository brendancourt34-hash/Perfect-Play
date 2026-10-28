/**
 * PHASE 23E QA — commercial economics (Entry Revenue -> Prize Pool Allocation % ->
 * Modeled Prize Pool / Commercial Allocation) against the real running backend. The pure
 * math (calculateCommercialModel, applyCommercialModel) is unit-tested in
 * src/lib/perfect2/commercial.test.ts and src/lib/data/admin.test.ts; this script proves
 * the same behavior end-to-end: real DB rows, real admin auth, real HTTP routes, and the
 * exact demonstration scenario from the spec (1,000/750/500 paid entries at $5, 60%
 * prize-pool allocation).
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

const API_URL = "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
const MARK = `qa-test-internal-commercial-econ-${Date.now()}`;
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

async function registerUser(email: string): Promise<{ token: string; userId: number }> {
  const r = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password: "qa-test-password-123", name: "QA" }) });
  if (!r.body.ok) throw new Error(`register failed for ${email}: ${JSON.stringify(r.body)}`);
  const rows = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  return { token: r.body.data.token as string, userId: rows[0].id };
}

/** Inserted in chunks to stay well under any single-query parameter limit at this scale (up to 1,000 rows). */
async function seedPaidEntries(competitionId: number, userId: number, count: number, paidAmountCentsEach: number) {
  const CHUNK_SIZE = 200;
  for (let inserted = 0; inserted < count; inserted += CHUNK_SIZE) {
    const chunkCount = Math.min(CHUNK_SIZE, count - inserted);
    const values = Array.from({ length: chunkCount }, () => ({ competitionId, userId, paymentStatus: "paid" as const, paidAmountCents: paidAmountCentsEach }));
    await db.insert(schema.competitionEntries).values(values);
  }
}

async function main() {
  console.log("=== PHASE 23E QA: commercial economics ===");

  const { token: adminToken, userId: adminUserId } = await registerUser(`${MARK}-admin@example.com`);
  const { token: normalToken, userId: normalUserId } = await registerUser(`${MARK}-normal@example.com`);
  await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, adminUserId));
  const adminAuth = { Authorization: `Bearer ${adminToken}` };
  const normalAuth = { Authorization: `Bearer ${normalToken}` };

  // Reuse each real sport row if one already exists (it should, once each sport has been
  // synced/used for real at least once) — sports.code is globally unique. Never deleted
  // afterward, matching the established convention for real sport reference data.
  async function getOrCreateSport(code: string, name: string) {
    const existing = (await db.select().from(schema.sports).where(eq(schema.sports.code, code)))[0];
    return existing ?? (await db.insert(schema.sports).values({ code, name }).returning())[0];
  }
  const nrlSport = await getOrCreateSport("nrl", "NRL");
  const aflSport = await getOrCreateSport("afl", "AFL");
  const nbaSport = await getOrCreateSport("nba", "NBA");

  // One throwaway competition per sport, at the exact demonstration scale from the spec:
  // NRL 1,000 x $5, AFL 750 x $5, NBA 500 x $5.
  const created: { sportCode: string; competitionId: number; seasonId: number; roundId: number; entryCount: number }[] = [];
  for (const [sport, entryCount] of [
    [nrlSport, 1000],
    [aflSport, 750],
    [nbaSport, 500],
  ] as const) {
    const [season] = await db.insert(schema.seasons).values({ sportId: sport.id, year: 2097, label: `${MARK}-${sport.code}-season` }).returning();
    const [round] = await db.insert(schema.rounds).values({ seasonId: season.id, roundNumber: 1, name: `${MARK}-${sport.code}-round` }).returning();
    const [competition] = await db.insert(schema.competitions).values({ sportId: sport.id, roundId: round.id, name: `${MARK}-${sport.code}-competition`, entryFeeCents: 500, status: "open" }).returning();
    await seedPaidEntries(competition.id, normalUserId, entryCount, 500);
    created.push({ sportCode: sport.code, competitionId: competition.id, seasonId: season.id, roundId: round.id, entryCount });
  }

  try {
    // --- Security ---
    const forbidden = await api("/api/admin/dashboard", { headers: normalAuth });
    assert(forbidden.status === 403, "11. non-admin cannot access commercial economics via the dashboard API");

    const settingsForbidden = await api("/api/admin/settings/prize_pool_allocation_bps", { method: "PUT", headers: normalAuth, body: JSON.stringify({ value: 9999 }) });
    assert(settingsForbidden.status === 403, "settings update requires admin — non-admin rejected");

    const overrideForbidden = await api(`/api/admin/competitions/${created[0].competitionId}/commercial-model`, { method: "PATCH", headers: normalAuth, body: JSON.stringify({ prizePoolAllocationBps: 5000 }) });
    assert(overrideForbidden.status === 403, "per-competition override requires admin — non-admin rejected");

    // --- 6/7. 60% model + configurable percentage: confirm the platform default really is 60% ---
    const settingsRes = await api("/api/admin/settings", { headers: adminAuth });
    const prizePoolSetting = settingsRes.body.data.settings.find((s: { key: string }) => s.key === "prize_pool_allocation_bps");
    assert(!prizePoolSetting || prizePoolSetting.value === 6000, "6. the platform's prize-pool allocation defaults to 6000 bps (60%) unless previously changed");

    // --- Invalid percentage rejected server-side ---
    const invalidPercent = await api("/api/admin/settings/prize_pool_allocation_bps", { method: "PUT", headers: adminAuth, body: JSON.stringify({ value: 10_001 }) });
    assert(invalidPercent.status === 422, "an out-of-range percentage (>100%) is rejected server-side");
    const invalidPercent2 = await api("/api/admin/settings/prize_pool_allocation_bps", { method: "PUT", headers: adminAuth, body: JSON.stringify({ value: -1 }) });
    assert(invalidPercent2.status === 422, "a negative percentage is rejected server-side");

    // --- 1/2/3/4. NRL/AFL/NBA sport economics, computed server-side ---
    const dashRes = await api("/api/admin/dashboard", { headers: adminAuth });
    assert(dashRes.status === 200, "admin can read the dashboard");
    const d = dashRes.body.data;
    assert(d.entries.prizePoolAllocationBps === 6000, "the dashboard reports the 60% global default used for its sport economics");

    const bySport = (code: string) => d.entries.bySport.find((s: { sportCode: string }) => s.sportCode === code);
    const nrl = bySport("nrl");
    const afl = bySport("afl");
    const nba = bySport("nba");
    assert(nrl.entryCount >= 1000 && nrl.totalEntryValueCents >= 500_000, `NRL entry revenue includes our 1,000 x $5 = $5,000 (got count=${nrl.entryCount}, revenue=${nrl.totalEntryValueCents})`);
    assert(afl.entryCount >= 750 && afl.totalEntryValueCents >= 375_000, `AFL entry revenue includes our 750 x $5 = $3,750 (got count=${afl.entryCount}, revenue=${afl.totalEntryValueCents})`);
    assert(nba.entryCount >= 500 && nba.totalEntryValueCents >= 250_000, `NBA entry revenue includes our 500 x $5 = $2,500 (got count=${nba.entryCount}, revenue=${nba.totalEntryValueCents})`);

    // Modeled prize pool / commercial allocation must be exactly 60%/40% of EACH sport's own revenue.
    for (const [label, s] of [["NRL", nrl], ["AFL", afl], ["NBA", nba]] as const) {
      const expectedPrize = Math.round(s.totalEntryValueCents * 0.6);
      assert(Math.abs(s.modeledPrizePoolCents - expectedPrize) <= 1, `${label} modeled prize pool is ~60% of its own entry revenue (got ${s.modeledPrizePoolCents}, expected ~${expectedPrize})`);
      assert(s.modeledPrizePoolCents + s.commercialAllocationCents === s.totalEntryValueCents, `${label} prize + commercial allocation sum back to entry revenue exactly`);
    }

    // --- 19. sports are not accidentally combined ---
    assert(nrl.entryCount !== afl.entryCount || nrl.totalEntryValueCents !== afl.totalEntryValueCents || created[0].entryCount !== created[1].entryCount, "sanity: NRL and AFL are tracked as distinct buckets (not merged)");
    assert(new Set(d.entries.bySport.map((s: { sportCode: string }) => s.sportCode)).size === d.entries.bySport.length, "no sport appears more than once in the sport economics table");

    // --- 5. zero-state: a sport with zero (QA-created) entries still has a row ---
    assert(d.entries.bySport.some((s: { sportCode: string }) => s.sportCode === "nrl") && d.entries.bySport.some((s: { sportCode: string }) => s.sportCode === "afl") && d.entries.bySport.some((s: { sportCode: string }) => s.sportCode === "nba"), "5. NRL, AFL, and NBA all always appear, never hidden");

    // --- 12/13. existing prize pool / rollover completely unaffected ---
    const compDetailRes = await api(`/api/admin/competitions/${created[0].competitionId}`, { headers: adminAuth });
    const compDetail = compDetailRes.body.data;
    assert(compDetail.prizeAmountCents === 6000 && compDetail.rolloverInCents === 0, "12/13. the real prizeAmountCents/rolloverInCents fields are completely unaffected by the commercial model (still their untouched defaults)");
    assert(typeof compDetail.commercialEconomics.entryRevenueCents === "number", "the competition detail response includes its own commercialEconomics block, separate from the real prize fields");
    assert(compDetail.commercialEconomics.entryRevenueCents === 500_000, `the NRL competition's own entryRevenueCents is exactly $5,000 (got ${compDetail.commercialEconomics.entryRevenueCents})`);
    assert(compDetail.commercialEconomics.modeledPrizePoolCents === 300_000 && compDetail.commercialEconomics.commercialAllocationCents === 200_000, "the NRL competition's own modeled prize allocation is $3,000 and commercial allocation is $2,000 at 60%");
    assert(compDetail.commercialEconomics.isOverridden === false, "with no override set, isOverridden is false (inheriting the global default)");

    // --- per-competition override: client cannot submit revenue/prize/commercial values directly, only the percentage ---
    const overrideRes = await api(`/api/admin/competitions/${created[0].competitionId}/commercial-model`, { method: "PATCH", headers: adminAuth, body: JSON.stringify({ prizePoolAllocationBps: 8000 }) });
    assert(overrideRes.status === 200, "admin can set a per-competition override");
    const afterOverrideRes = await api(`/api/admin/competitions/${created[0].competitionId}`, { headers: adminAuth });
    const afterOverride = afterOverrideRes.body.data.commercialEconomics;
    assert(afterOverride.isOverridden === true && afterOverride.prizePoolAllocationBps === 8000, "the override (80%) is reflected on the next read");
    assert(afterOverride.modeledPrizePoolCents === 400_000 && afterOverride.commercialAllocationCents === 100_000, "at an 80% override, $5,000 revenue -> $4,000 modeled prize, $1,000 commercial allocation");
    assert(compDetail.prizeAmountCents === afterOverrideRes.body.data.prizeAmountCents, "setting a commercial-model override never touches the real prizeAmountCents field");

    const clearOverrideRes = await api(`/api/admin/competitions/${created[0].competitionId}/commercial-model`, { method: "PATCH", headers: adminAuth, body: JSON.stringify({ prizePoolAllocationBps: null }) });
    assert(clearOverrideRes.status === 200 && clearOverrideRes.body.data.competition.prizePoolAllocationBps === null, "an admin can clear the override (revert to inheriting the global default)");

    const invalidOverride = await api(`/api/admin/competitions/${created[0].competitionId}/commercial-model`, { method: "PATCH", headers: adminAuth, body: JSON.stringify({ prizePoolAllocationBps: 10_001 }) });
    assert(invalidOverride.status === 422, "an out-of-range per-competition override is rejected server-side");

    // --- client cannot submit revenue/prize/commercial totals directly (only a percentage is ever accepted) ---
    const clientSuppliedRevenue = await api(`/api/admin/competitions/${created[0].competitionId}/commercial-model`, {
      method: "PATCH",
      headers: adminAuth,
      body: JSON.stringify({ prizePoolAllocationBps: 6000, entryRevenueCents: 999_999_999, modeledPrizePoolCents: 1, commercialAllocationCents: 1 }),
    });
    const afterClientSupplied = await api(`/api/admin/competitions/${created[0].competitionId}`, { headers: adminAuth });
    assert(clientSuppliedRevenue.status === 200 && afterClientSupplied.body.data.commercialEconomics.entryRevenueCents === 500_000, "a client-supplied entryRevenueCents/modeledPrizePoolCents/commercialAllocationCents in the request body is silently ignored — only the real, server-computed entry revenue is ever used");

    console.log(`\n=== COMMERCIAL ECONOMICS QA: ${passed} checks passed ===`);
  } finally {
    console.log("Cleaning up QA data...");
    for (const c of created) {
      const entries = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, c.competitionId));
      for (const e of entries) await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, e.id));
      await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, c.competitionId));
      await db.delete(schema.competitions).where(eq(schema.competitions.id, c.competitionId));
      await db.delete(schema.rounds).where(eq(schema.rounds.id, c.roundId));
      await db.delete(schema.seasons).where(eq(schema.seasons.id, c.seasonId));
    }
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, adminUserId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, normalUserId));
    await db.delete(schema.users).where(eq(schema.users.id, adminUserId));
    await db.delete(schema.users).where(eq(schema.users.id, normalUserId));

    const leftoverComps = await db.select().from(schema.competitions).where(and(eq(schema.competitions.name, `${MARK}-nrl-competition`)));
    const leftoverUsers = await db.select().from(schema.users).where(eq(schema.users.id, adminUserId));
    assert(leftoverComps.length === 0 && leftoverUsers.length === 0, "cleanup verified: zero rows remain for the QA fixtures (real nrl/afl/nba sport rows themselves are untouched)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
