/**
 * Live QA — entry-fee payment confirmation path. Verifies the full flow: payment
 * initiated -> payment_transactions row -> pending/paid state -> provider webhook ->
 * transaction confirmation -> competition_entries.paymentStatus/paidAmountCents ->
 * entry becomes genuinely confirmed. Covers the exact defect this audit fixed: a "pending"
 * entry-fee charge (the only state DevPaymentProvider ever produces) previously never got
 * its entry updated once a real provider would eventually confirm "paid" via webhook —
 * this script simulates that confirmation directly (bypassing the real HTTP webhook route,
 * which is correctly unreachable today since no real provider is configured — see
 * scenario 5 below, which verifies that gate live instead).
 *
 * Uses the DIRECT single-entry endpoint (/api/[sport]/rounds/[roundId]/entries), which is
 * the one that actually goes through chargeForEntry/the async payment-provider path —
 * unlike the wallet-funded package-purchase path (always synchronously "paid").
 */
import { getDb, schema } from "../src/db";
import { eq, and } from "drizzle-orm";
import { applyWebhookEventToTransaction } from "../src/lib/data/payment-transactions";
import { voidGame } from "../src/lib/data/void";

const db = getDb();
const MARK = `qa-entrypay-${Date.now()}`;
const API = "http://localhost:3000";

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("PASS: " + msg);
  passed++;
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  const [sport] = await db.select().from(schema.sports).where(eq(schema.sports.code, "nrl")).limit(1);
  const testYear = 2600 + (Date.now() % 900);
  const [season] = await db.insert(schema.seasons).values({ sportId: sport.id, year: testYear, label: MARK }).returning();
  const [round] = await db.insert(schema.rounds).values({ seasonId: season.id, roundNumber: 1, name: MARK }).returning();
  const [teamA] = await db.insert(schema.teams).values({ sportId: sport.id, slug: `${MARK}-a`, name: "Pay A", shortName: "PA" }).returning();
  const [teamB] = await db.insert(schema.teams).values({ sportId: sport.id, slug: `${MARK}-b`, name: "Pay B", shortName: "PB" }).returning();
  const [game] = await db
    .insert(schema.games)
    .values({ roundId: round.id, homeTeamId: teamA.id, awayTeamId: teamB.id, kickoff: new Date(Date.now() + 3600_000), status: "scheduled" })
    .returning();
  const [scorer] = await db.insert(schema.players).values({ sportId: sport.id, teamId: teamA.id, firstName: MARK, lastName: "Scorer", position: "Any" }).returning();
  await db.insert(schema.gameLineups).values({ gameId: game.id, playerId: scorer.id, teamId: teamA.id, position: "Any" });

  const email = `${MARK}-user@example.com`;
  const reg = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password: "qa-test-password-123", name: "Entry Pay QA" }) });
  const userId = reg.body.data.user.id as number;
  const auth = { Authorization: `Bearer ${reg.body.data.token}` };

  // --- Scenario 1: pending payment must NOT falsely mark the entry paid ---
  const createRes = await api(`/api/nrl/rounds/${round.id}/entries`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ selections: [{ gameId: game.id, playerIds: [scorer.id] }] }),
  });
  assert(createRes.status === 201, `entry created via the direct (chargeForEntry) path (got ${createRes.status}): ${JSON.stringify(createRes.body).slice(0, 200)}`);
  const entryId = createRes.body.data.entryId as number;

  const entryAfterCreate = (await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId)))[0];
  assert(entryAfterCreate.paymentStatus === "pending", `the dev provider's "pending" result honestly leaves the entry pending, never falsely paid (got ${entryAfterCreate.paymentStatus})`);
  assert(entryAfterCreate.paidAmountCents === null, `paidAmountCents stays null while genuinely unpaid (got ${entryAfterCreate.paidAmountCents})`);

  const transactionRow = (await db.select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.competitionEntryId, entryId)))[0];
  assert(!!transactionRow && transactionRow.status === "pending", "a real payment_transactions row exists, honestly pending");
  const competitionRow = (await db.select().from(schema.competitions).where(eq(schema.competitions.roundId, round.id)))[0];

  // --- Scenario 2: a genuine "paid" webhook confirms the entry ---
  const confirmResult = await applyWebhookEventToTransaction(transactionRow.id, "paid");
  assert(confirmResult.status === "ok", `webhook confirmation succeeds (${confirmResult.status === "unavailable" ? confirmResult.message : ""})`);

  const entryAfterPaid = (await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId)))[0];
  assert(entryAfterPaid.paymentStatus === "paid", `*** the entry is now correctly marked paid (got ${entryAfterPaid.paymentStatus}) ***`);
  assert(entryAfterPaid.paidAmountCents === competitionRow.entryFeeCents, `paidAmountCents matches the real entry fee exactly (got ${entryAfterPaid.paidAmountCents}, expected ${competitionRow.entryFeeCents})`);

  const selectionsAfterPaid = await db.select().from(schema.entrySelections).where(eq(schema.entrySelections.entryId, entryId));
  assert(selectionsAfterPaid.length === 1 && selectionsAfterPaid[0].selectedPlayer1Id === scorer.id, "the entry's original selections are completely untouched by the payment confirmation");

  // --- Scenario 3: duplicate webhook delivery must not double-apply or error ---
  const duplicateResult = await applyWebhookEventToTransaction(transactionRow.id, "paid");
  assert(duplicateResult.status === "ok", "a duplicate/replayed webhook for the same (already paid) transaction is accepted, not an error");
  const entryAfterDuplicate = (await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId)))[0];
  assert(entryAfterDuplicate.paymentStatus === "paid" && entryAfterDuplicate.paidAmountCents === competitionRow.entryFeeCents, "the duplicate webhook leaves the entry exactly as it was — no double-application");
  const allEntriesForUser = await db.select().from(schema.competitionEntries).where(and(eq(schema.competitionEntries.competitionId, competitionRow.id), eq(schema.competitionEntries.userId, userId)));
  assert(allEntriesForUser.length === 1, `still exactly one entry exists — a duplicate webhook never creates a duplicate entry (got ${allEntriesForUser.length})`);
  const allTransactionsForUser = await db.select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.userId, userId));
  assert(allTransactionsForUser.length === 1, `still exactly one payment_transactions row exists — a duplicate webhook never creates a duplicate charge (got ${allTransactionsForUser.length})`);

  // --- Scenario 4: a "failed processing then retry" recovery — simulate the transaction
  // already showing "paid" in the DB while the entry never actually got updated (exactly
  // what a crash between the two writes would leave behind), then confirm calling the
  // webhook handler again (a natural retry) self-heals it. ---
  await db.update(schema.competitionEntries).set({ paymentStatus: "pending", paidAmountCents: null }).where(eq(schema.competitionEntries.id, entryId));
  const entryBeforeRetry = (await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId)))[0];
  assert(entryBeforeRetry.paymentStatus === "pending", "simulated partial-failure state set up: transaction paid, entry still pending");
  const retryResult = await applyWebhookEventToTransaction(transactionRow.id, "paid");
  assert(retryResult.status === "ok", "retrying the webhook (transaction already paid -> paid again) succeeds, not rejected as illegal");
  const entryAfterRetry = (await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId)))[0];
  assert(entryAfterRetry.paymentStatus === "paid" && entryAfterRetry.paidAmountCents === competitionRow.entryFeeCents, `*** the retry self-heals the out-of-sync entry back to paid (got ${entryAfterRetry.paymentStatus}) ***`);

  // --- Scenario 5: invalid webhook / no real provider configured — the real HTTP route
  // must never process anything, regardless of signature, while no provider is connected. ---
  const rawWebhookRes = await api("/api/payments/webhook/dev-test-only", {
    method: "POST",
    headers: { "x-webhook-signature": "totally-fake-signature" },
    body: JSON.stringify({ providerTransactionId: "fake", status: "paid" }),
  });
  assert(rawWebhookRes.status === 401 || rawWebhookRes.status === 404, `the real webhook route rejects every request while no real provider is configured (got ${rawWebhookRes.status})`);
  const entryAfterFakeWebhook = (await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId)))[0];
  assert(entryAfterFakeWebhook.paymentStatus === "paid", "the fake webhook attempt had zero effect on the real entry");

  // --- Scenario 6: payment confirmation arriving after cutoff must not bypass cutoff
  // rules — a SEPARATE entry, confirmed only after its game has already gone live. The
  // entry/selections were validly locked in before cutoff; only the payment bookkeeping
  // catches up late, and it must never let the customer touch selections or create a new
  // entry at this point. ---
  const [game2] = await db
    .insert(schema.games)
    .values({ roundId: round.id, homeTeamId: teamA.id, awayTeamId: teamB.id, kickoff: new Date(Date.now() + 3600_000), status: "scheduled" })
    .returning();
  const [scorer2] = await db.insert(schema.players).values({ sportId: sport.id, teamId: teamA.id, firstName: MARK, lastName: "Scorer2", position: "Any" }).returning();
  await db.insert(schema.gameLineups).values({ gameId: game2.id, playerId: scorer2.id, teamId: teamA.id, position: "Any" });
  const email2 = `${MARK}-user2@example.com`;
  const reg2 = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email: email2, password: "qa-test-password-123", name: "Entry Pay QA 2" }) });
  const auth2 = { Authorization: `Bearer ${reg2.body.data.token}` };
  const create2Res = await api(`/api/nrl/rounds/${round.id}/entries`, {
    method: "POST",
    headers: auth2,
    body: JSON.stringify({
      selections: [
        { gameId: game.id, playerIds: [scorer.id] },
        { gameId: game2.id, playerIds: [scorer2.id] },
      ],
    }),
  });
  assert(create2Res.status === 201, `a second entry (for the cutoff scenario) is created before cutoff, while the game is still scheduled (got ${create2Res.status}): ${JSON.stringify(create2Res.body).slice(0, 200)}`);
  const entryId2 = create2Res.body.data.entryId as number;
  const transaction2 = (await db.select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.competitionEntryId, entryId2)))[0];

  // Time passes — the game (and therefore the round's cutoff) has now gone live.
  await db.update(schema.games).set({ status: "live" }).where(eq(schema.games.id, game.id));

  const lateConfirm = await applyWebhookEventToTransaction(transaction2.id, "paid");
  assert(lateConfirm.status === "ok", "a payment confirmation arriving after cutoff still succeeds for the already-existing entry");
  const entry2AfterLateConfirm = (await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId2)))[0];
  assert(entry2AfterLateConfirm.paymentStatus === "paid", "the late confirmation correctly marks the pre-existing entry paid");
  const selections2AfterLateConfirm = await db.select().from(schema.entrySelections).where(eq(schema.entrySelections.entryId, entryId2));
  assert(
    selections2AfterLateConfirm.length === 2 && selections2AfterLateConfirm.some((s) => s.selectedPlayer1Id === scorer.id) && selections2AfterLateConfirm.some((s) => s.selectedPlayer1Id === scorer2.id),
    "the late confirmation never touched the entry's already-locked-in selections",
  );

  // A brand-new user (never entered this round before) attempting a fresh submission now
  // that game has gone live — a complete, otherwise-valid selection set, isolating the
  // rejection to the cutoff/lock rule specifically (not a duplicate-entry or incomplete-
  // selections confound).
  const email2b = `${MARK}-user2b@example.com`;
  const reg2b = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email: email2b, password: "qa-test-password-123", name: "Entry Pay QA 2b" }) });
  const auth2b = { Authorization: `Bearer ${reg2b.body.data.token}` };
  const lateEntryAttempt = await api(`/api/nrl/rounds/${round.id}/entries`, {
    method: "POST",
    headers: auth2b,
    body: JSON.stringify({
      selections: [
        { gameId: game.id, playerIds: [scorer.id] },
        { gameId: game2.id, playerIds: [scorer2.id] },
      ],
    }),
  });
  assert(
    lateEntryAttempt.status === 422 && /already started/i.test(JSON.stringify(lateEntryAttempt.body)),
    `a late payment confirmation does not reopen the cutoff — a fresh, complete submission is still rejected specifically because the game already started (got ${lateEntryAttempt.status}): ${JSON.stringify(lateEntryAttempt.body).slice(0, 200)}`,
  );

  // Restore game to scheduled for the next scenario's own game3 (unrelated), no effect on already-settled state above.
  await db.update(schema.games).set({ status: "scheduled" }).where(eq(schema.games.id, game.id));

  // --- Scenario 7: concurrent duplicate webhook delivery must not corrupt state ---
  const [game3] = await db
    .insert(schema.games)
    .values({ roundId: round.id, homeTeamId: teamA.id, awayTeamId: teamB.id, kickoff: new Date(Date.now() + 3600_000), status: "scheduled" })
    .returning();
  const [scorer3] = await db.insert(schema.players).values({ sportId: sport.id, teamId: teamA.id, firstName: MARK, lastName: "Scorer3", position: "Any" }).returning();
  await db.insert(schema.gameLineups).values({ gameId: game3.id, playerId: scorer3.id, teamId: teamA.id, position: "Any" });
  const email3 = `${MARK}-user3@example.com`;
  const reg3 = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email: email3, password: "qa-test-password-123", name: "Entry Pay QA 3" }) });
  const auth3 = { Authorization: `Bearer ${reg3.body.data.token}` };
  const create3Res = await api(`/api/nrl/rounds/${round.id}/entries`, {
    method: "POST",
    headers: auth3,
    body: JSON.stringify({
      selections: [
        { gameId: game.id, playerIds: [scorer.id] },
        { gameId: game2.id, playerIds: [scorer2.id] },
        { gameId: game3.id, playerIds: [scorer3.id] },
      ],
    }),
  });
  assert(create3Res.status === 201, `a third entry is created for the concurrency scenario (got ${create3Res.status}): ${JSON.stringify(create3Res.body).slice(0, 200)}`);
  const entryId3 = create3Res.body.data.entryId as number;
  const transaction3 = (await db.select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.competitionEntryId, entryId3)))[0];

  const concurrentResults = await Promise.all(Array.from({ length: 8 }, () => applyWebhookEventToTransaction(transaction3.id, "paid")));
  assert(concurrentResults.every((r) => r.status === "ok"), "8 concurrent identical webhook deliveries all succeed without error");
  const entry3AfterConcurrent = (await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId3)))[0];
  assert(entry3AfterConcurrent.paymentStatus === "paid" && entry3AfterConcurrent.paidAmountCents === competitionRow.entryFeeCents, "the entry ends up correctly paid exactly once despite 8 concurrent webhook deliveries");
  const allEntriesForUser3 = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.userId, reg3.body.data.user.id));
  assert(allEntriesForUser3.length === 1, "no duplicate entries were created by the concurrent webhook storm");

  // --- Settlement integrity: a payment-failed entry must never be able to win a prize ---
  const [game4] = await db
    .insert(schema.games)
    .values({ roundId: round.id, homeTeamId: teamA.id, awayTeamId: teamB.id, kickoff: new Date(Date.now() + 3600_000), status: "scheduled" })
    .returning();
  const [scorer4] = await db.insert(schema.players).values({ sportId: sport.id, teamId: teamA.id, firstName: MARK, lastName: "Scorer4", position: "Any" }).returning();
  await db.insert(schema.gameLineups).values({ gameId: game4.id, playerId: scorer4.id, teamId: teamA.id, position: "Any" });
  const email4 = `${MARK}-user4@example.com`;
  const reg4 = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email: email4, password: "qa-test-password-123", name: "Entry Pay QA 4" }) });
  const auth4 = { Authorization: `Bearer ${reg4.body.data.token}` };
  const create4Res = await api(`/api/nrl/rounds/${round.id}/entries`, {
    method: "POST",
    headers: auth4,
    body: JSON.stringify({
      selections: [
        { gameId: game.id, playerIds: [scorer.id] },
        { gameId: game2.id, playerIds: [scorer2.id] },
        { gameId: game3.id, playerIds: [scorer3.id] },
        { gameId: game4.id, playerIds: [scorer4.id] },
      ],
    }),
  });
  assert(create4Res.status === 201, `a fourth entry is created — this one will have its payment fail (got ${create4Res.status}): ${JSON.stringify(create4Res.body).slice(0, 200)}`);
  const entryId4 = create4Res.body.data.entryId as number;
  const transaction4 = (await db.select().from(schema.paymentTransactions).where(eq(schema.paymentTransactions.competitionEntryId, entryId4)))[0];
  const failResult = await applyWebhookEventToTransaction(transaction4.id, "failed");
  assert(failResult.status === "ok", "a genuine payment failure webhook is applied successfully");
  const entry4AfterFail = (await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId4)))[0];
  assert(entry4AfterFail.paymentStatus === "failed", "the entry correctly reflects the failed payment, never left stuck as pending");

  // Make game4 final with the winning stat — this entry WOULD be PERFECT by selection alone.
  await db.update(schema.games).set({ status: "final", kickoff: new Date(Date.now() - 3600_000), homeScore: 10, awayScore: 6 }).where(eq(schema.games.id, game4.id));
  await db.insert(schema.playerGameStats).values({ gameId: game4.id, playerId: scorer4.id, teamId: teamA.id, tries: 1 });
  // Void every other game properly (the real admin resolution path — marks the game
  // cancelled AND flips its pending selections to "void" so they never block PERFECT and
  // never get stuck as permanently "pending") so the whole competition can settle down to
  // exactly what game4's outcome decides.
  await voidGame(game.id, "qa test cleanup");
  await voidGame(game2.id, "qa test cleanup");
  await voidGame(game3.id, "qa test cleanup");

  const adminReg = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email: `${MARK}-admin@example.com`, password: "qa-test-password-123", name: "Entry Pay Admin" }) });
  const adminId = adminReg.body.data.user.id as number;
  await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, adminId));
  const adminAuth = { Authorization: `Bearer ${adminReg.body.data.token}` };
  await api(`/api/admin/competitions/${competitionRow.id}/close`, { method: "POST", headers: adminAuth });
  const settleRes = await api(`/api/admin/competitions/${competitionRow.id}/settle`, { method: "POST", headers: adminAuth });
  assert(settleRes.status === 200, `settlement succeeds (${JSON.stringify(settleRes.body).slice(0, 200)})`);

  const entry4AfterSettle = (await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId4)))[0];
  assert(entry4AfterSettle.result === "perfect", "the failed-payment entry's selection is genuinely correct (perfect by picks alone)");
  assert(entry4AfterSettle.prizeAllocationCents === 0, `*** the failed-payment entry is EXCLUDED from winning despite being selection-perfect (got ${entry4AfterSettle.prizeAllocationCents}) ***`);
  const entryAfterSettle = (await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId)))[0];
  assert(entryAfterSettle.result === "perfect" && entryAfterSettle.prizeAllocationCents > 0, `the genuinely-paid entry correctly wins its share (got ${entryAfterSettle.prizeAllocationCents})`);

  console.log(`\n${passed} checks passed`);

  // --- cleanup ---
  const allEntryIds = [entryId, entryId2, entryId3, entryId4];
  for (const id of allEntryIds) await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, id));
  await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, competitionRow.id));
  await db.delete(schema.walletTransactions).where(eq(schema.walletTransactions.userId, userId));
  const allUserIds = [userId, reg2.body.data.user.id, reg2b.body.data.user.id, reg3.body.data.user.id, reg4.body.data.user.id, adminId];
  for (const uid of allUserIds) await db.delete(schema.paymentTransactions).where(eq(schema.paymentTransactions.userId, uid));
  await db.delete(schema.competitions).where(eq(schema.competitions.id, competitionRow.id));
  await db.delete(schema.playerGameStats).where(eq(schema.playerGameStats.gameId, game4.id));
  for (const g of [game, game2, game3, game4]) {
    await db.delete(schema.gameLineups).where(eq(schema.gameLineups.gameId, g.id));
    await db.delete(schema.games).where(eq(schema.games.id, g.id));
  }
  for (const p of [scorer, scorer2, scorer3, scorer4]) await db.delete(schema.players).where(eq(schema.players.id, p.id));
  await db.delete(schema.teams).where(eq(schema.teams.id, teamA.id));
  await db.delete(schema.teams).where(eq(schema.teams.id, teamB.id));
  await db.delete(schema.rounds).where(eq(schema.rounds.id, round.id));
  await db.delete(schema.seasons).where(eq(schema.seasons.id, season.id));
  for (const uid of allUserIds) {
    const sessions = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, uid));
    for (const s of sessions) await db.delete(schema.sessions).where(eq(schema.sessions.id, s.id));
    await db.delete(schema.users).where(eq(schema.users.id, uid));
  }
  console.log("cleaned up");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
