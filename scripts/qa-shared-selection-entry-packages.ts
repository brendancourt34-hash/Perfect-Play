/**
 * QA — "one shared selection set -> N identical entries" entry-package model. Driven
 * entirely through the REAL running HTTP API against the REAL live NBA round 1 data (real
 * games, real eligible players) — no mocks. Uses the existing admin wallet-adjust
 * endpoint to fund clearly-labelled test accounts (the only way to get real balance into
 * a wallet in this environment, since real deposits can never confirm by design).
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/qa-shared-selection-entry-packages.ts
 */
import { neon } from "@neondatabase/serverless";

const API_URL = "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL!);
let pass = 0;
let fail = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    pass++;
    console.log(`  PASS: ${label}`);
  } else {
    fail++;
    console.log(`  FAIL: ${label}`, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json();
  return { status: res.status, body };
}

async function registerOrLogin(email: string, password: string, name: string) {
  const reg = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password, name }) });
  if (reg.body.ok) return { token: reg.body.data.token as string, userId: reg.body.data.user.id as number };
  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  if (!login.body.ok) throw new Error(`Could not register or log in ${email}: ${JSON.stringify(login.body)}`);
  return { token: login.body.data.token as string, userId: login.body.data.user.id as number };
}

async function main() {
  const PASSWORD = "Stage23i-entrypkg-2026!";
  const adminEmail = "stage23i-populate-admin@perfect2.test";
  const { token: adminToken } = await registerOrLogin(adminEmail, "Stage23i-populate-2026!", "Stage Populate Admin");
  await sql`UPDATE users SET is_admin = true WHERE email = ${adminEmail}`;
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };

  // Real round 1 (NBA), real games, real eligible players.
  const roundsResp = await api("/api/nba/rounds");
  const round1 = roundsResp.body.data.rounds.find((r: { roundNumber: number }) => r.roundNumber === 1);
  const detail = await api(`/api/nba/rounds/${round1.id}`);
  const games = detail.body.data.games as { id: number; eligiblePlayers: { id: number }[] }[];
  console.log(`Using real round 1 (id=${round1.id}), ${games.length} real games.`);
  const realSelections = games.map((g) => ({ gameId: g.id, playerIds: [g.eligiblePlayers[0].id] }));
  const differentSelections = games.map((g) => ({ gameId: g.id, playerIds: [g.eligiblePlayers[g.eligiblePlayers.length - 1].id] }));

  async function fundBuyer(email: string) {
    const { token, userId } = await registerOrLogin(email, PASSWORD, "Stage Entry Package QA");
    await api(`/api/admin/users/${userId}/wallet/adjust`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ amountCents: 100_00, reason: "QA funding for entry-package tests" }),
    });
    return { token, userId, headers: { Authorization: `Bearer ${token}` } };
  }

  // ---- Test 1: 1-entry package creates exactly 1 entry ----
  console.log("\n=== Test 1: 1-entry package ===");
  const buyer1 = await fundBuyer(`stage23i-pkg1-${Date.now()}@perfect2.test`);
  const r1 = await api(`/api/nba/rounds/${round1.id}/enter-package`, {
    method: "POST",
    headers: buyer1.headers,
    body: JSON.stringify({ packageId: (await api("/api/entry-packages")).body.data.packages.find((p: { entryCount: number }) => p.entryCount === 1).id, selections: realSelections, idempotencyKey: "t1" }),
  });
  check("1-entry purchase succeeds", r1.body.ok, r1.body);
  check("creates exactly 1 entry", r1.body.ok && r1.body.data.entryIds.length === 1, r1.body.data);
  check("charges exactly $5 (500c)", r1.body.ok && r1.body.data.amountPaidCents === 500, r1.body.data);

  // ---- Test 2/4: 5-entry package, identical selections, single $20 debit ----
  console.log("\n=== Test 2: 5-entry package -> 5 identical entries, ONE $20 debit ===");
  const buyer2 = await fundBuyer(`stage23i-pkg5-${Date.now()}@perfect2.test`);
  const packages = (await api("/api/entry-packages")).body.data.packages;
  const pkg5 = packages.find((p: { entryCount: number }) => p.entryCount === 5);
  const balBefore5 = (await api("/api/me/wallet", { headers: buyer2.headers })).body.data.balanceCents;
  const r2 = await api(`/api/nba/rounds/${round1.id}/enter-package`, {
    method: "POST",
    headers: buyer2.headers,
    body: JSON.stringify({ packageId: pkg5.id, selections: realSelections, idempotencyKey: "t2" }),
  });
  check("5-entry purchase succeeds", r2.body.ok, r2.body);
  check("creates exactly 5 entries", r2.body.ok && r2.body.data.entryIds.length === 5, r2.body.data);
  check("charges exactly $20 (2000c), not 5x$5", r2.body.ok && r2.body.data.amountPaidCents === 2000, r2.body.data);
  const balAfter5 = (await api("/api/me/wallet", { headers: buyer2.headers })).body.data.balanceCents;
  check("wallet dropped by exactly 2000c (ONE debit)", balBefore5 - balAfter5 === 2000, { balBefore5, balAfter5 });

  // Verify all 5 entries have IDENTICAL selections in the real DB.
  const entryIds2: number[] = r2.body.data.entryIds;
  const selRows = await sql`SELECT entry_id, game_id, selected_player_1_id FROM entry_selections WHERE entry_id = ANY(${entryIds2}) ORDER BY entry_id, game_id`;
  const byEntry = new Map<number, string>();
  for (const row of selRows as { entry_id: number; game_id: number; selected_player_1_id: number }[]) {
    const key = byEntry.get(row.entry_id) ?? "";
    byEntry.set(row.entry_id, key + `${row.game_id}:${row.selected_player_1_id};`);
  }
  const distinctSelectionSets = new Set(byEntry.values());
  check("all 5 entries have IDENTICAL selection content", distinctSelectionSets.size === 1, [...distinctSelectionSets]);
  check("entries remain individually identifiable (5 distinct entry IDs)", new Set(entryIds2).size === 5, entryIds2);

  // ---- Test 3: reuse existing selections — a "malicious" different submission is IGNORED ----
  console.log("\n=== Test 3: buying more entries reuses EXISTING picks even if client submits different ones ===");
  const pkg1 = packages.find((p: { entryCount: number }) => p.entryCount === 1);
  const r3 = await api(`/api/nba/rounds/${round1.id}/enter-package`, {
    method: "POST",
    headers: buyer2.headers,
    body: JSON.stringify({ packageId: pkg1.id, selections: differentSelections, idempotencyKey: "t3" }),
  });
  check("additional 1-entry purchase succeeds", r3.body.ok, r3.body);
  const newEntryId = r3.body.ok ? r3.body.data.entryIds[0] : null;
  if (newEntryId) {
    const newSelRows = await sql`SELECT game_id, selected_player_1_id FROM entry_selections WHERE entry_id = ${newEntryId} ORDER BY game_id`;
    const newKey = (newSelRows as { game_id: number; selected_player_1_id: number }[]).map((r) => `${r.game_id}:${r.selected_player_1_id}`).sort().join(";");
    const originalKey = [...distinctSelectionSets][0]
      .split(";")
      .filter(Boolean)
      .sort()
      .join(";");
    check("new entry's selections match the ORIGINAL set, not the malicious submission", newKey === originalKey, { newKey, originalKey });
    const differentKey = differentSelections.map((s) => `${s.gameId}:${s.playerIds[0]}`).sort().join(";");
    check("new entry's selections do NOT match the different submission the client sent", newKey !== differentKey);
  }

  // ---- Test 4: entry cap enforcement (existing 6 entries now: 5+1) ----
  console.log("\n=== Test 4: entry cap — buyer now has 6 entries, cap is 10 ===");
  const entriesNow = (await api(`/api/nba/rounds/${round1.id}/entries`, { headers: buyer2.headers })).body.data;
  check("buyer2 has 6 existing entries", entriesNow.entries.length === 6, entriesNow.entries.length);
  const pkg10 = packages.find((p: { entryCount: number }) => p.entryCount === 10);
  const rOver = await api(`/api/nba/rounds/${round1.id}/enter-package`, {
    method: "POST",
    headers: buyer2.headers,
    body: JSON.stringify({ packageId: pkg10.id, selections: realSelections, idempotencyKey: "t4-over" }),
  });
  check("10-entry purchase REJECTED (6+10=16 > 10 cap)", !rOver.body.ok, rOver.body);
  const r5Over = await api(`/api/nba/rounds/${round1.id}/enter-package`, {
    method: "POST",
    headers: buyer2.headers,
    body: JSON.stringify({ packageId: pkg5.id, selections: realSelections, idempotencyKey: "t4-5over" }),
  });
  check("5-entry purchase REJECTED too (6+5=11 > 10 — remaining capacity of 4 is less than 5)", !r5Over.body.ok, r5Over.body);
  const rFit = await api(`/api/nba/rounds/${round1.id}/enter-package`, {
    method: "POST",
    headers: buyer2.headers,
    body: JSON.stringify({ packageId: pkg1.id, selections: realSelections, idempotencyKey: "t4-fit1" }),
  });
  // buyer2: 6 -> could go to 7 with a 1-entry package (still tests basic fit-check works)
  check("1-entry purchase within cap succeeds (6+1=7 <= 10)", rFit.body.ok, rFit.body);

  // ---- Test 5: insufficient funds creates NO entries and NO debit ----
  console.log("\n=== Test 5: insufficient funds ===");
  const { token: poorToken, headers: poorHeaders } = { token: "", headers: {} as Record<string, string> };
  void poorToken;
  const poorBuyer = await registerOrLogin(`stage23i-poor-${Date.now()}@perfect2.test`, PASSWORD, "Stage Poor QA");
  const poorAuthHeaders = { Authorization: `Bearer ${poorBuyer.token}` };
  const balPoorBefore = (await api("/api/me/wallet", { headers: poorAuthHeaders })).body.data.balanceCents;
  check("fresh test account starts at $0 balance", balPoorBefore === 0, balPoorBefore);
  const rPoor = await api(`/api/nba/rounds/${round1.id}/enter-package`, {
    method: "POST",
    headers: poorAuthHeaders,
    body: JSON.stringify({ packageId: pkg1.id, selections: realSelections, idempotencyKey: "t5" }),
  });
  check("purchase with $0 balance is rejected as insufficient_funds", !rPoor.body.ok, rPoor.body);
  const poorEntries = (await api(`/api/nba/rounds/${round1.id}/entries`, { headers: poorAuthHeaders })).body.data;
  check("zero entries created for the insufficient-funds attempt", poorEntries.entries.length === 0, poorEntries.entries.length);

  // ---- Test 6: retry idempotency — same key twice must not double-create/double-charge ----
  console.log("\n=== Test 6: retry with the SAME idempotency key does not double-charge or double-create ===");
  const buyer6 = await fundBuyer(`stage23i-retry-${Date.now()}@perfect2.test`);
  const balBefore6 = (await api("/api/me/wallet", { headers: buyer6.headers })).body.data.balanceCents;
  const key6 = "retry-key-fixed";
  const first = await api(`/api/nba/rounds/${round1.id}/enter-package`, {
    method: "POST",
    headers: buyer6.headers,
    body: JSON.stringify({ packageId: pkg1.id, selections: realSelections, idempotencyKey: key6 }),
  });
  const retry = await api(`/api/nba/rounds/${round1.id}/enter-package`, {
    method: "POST",
    headers: buyer6.headers,
    body: JSON.stringify({ packageId: pkg1.id, selections: realSelections, idempotencyKey: key6 }),
  });
  check("first purchase succeeds", first.body.ok, first.body);
  check("retry with same key also reports ok (idempotent, not an error)", retry.body.ok, retry.body);
  check("retry returns the SAME entryId(s) as the first attempt", first.body.ok && retry.body.ok && JSON.stringify(first.body.data.entryIds) === JSON.stringify(retry.body.data.entryIds), {
    first: first.body.data?.entryIds,
    retry: retry.body.data?.entryIds,
  });
  const balAfter6 = (await api("/api/me/wallet", { headers: buyer6.headers })).body.data.balanceCents;
  check("wallet only debited ONCE across both calls (dropped by exactly 500c, not 1000c)", balBefore6 - balAfter6 === 500, { balBefore6, balAfter6 });
  const entries6 = (await api(`/api/nba/rounds/${round1.id}/entries`, { headers: buyer6.headers })).body.data;
  check("exactly 1 real entry exists for buyer6 (not 2)", entries6.entries.length === 1, entries6.entries.length);

  console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
