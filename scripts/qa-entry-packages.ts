/**
 * PHASE 23 QA — entry-package purchases (wallet-funded, multi-entry) against the real
 * running backend (http://localhost:3000). Seeds temporary NRL fixtures, exercises the
 * real /api/entry-packages, /api/me/wallet/*, and /api/[sport]/rounds/[roundId]/enter-package
 * + GET entries endpoints through a real registered user, then deletes everything it
 * created — same lifecycle convention as scripts/qa-phase16-payment-flow.ts.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and } from "drizzle-orm";
import * as schema from "../src/db/schema";

const API_URL = "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

const MARK = "qa-test-internal-entry-packages";
let passed = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`PASS: ${msg}`);
  passed++;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function registerUser(email: string) {
  const result = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password: "qa-test-password-123", name: "QA Entry Packages" }),
  });
  if (!result.body.ok) throw new Error(`register failed for ${email}: ${JSON.stringify(result.body)}`);
  return result.body.data.token as string;
}

async function main() {
  console.log("=== PHASE 23 QA: entry-package purchases ===");

  // Reuse the real dev DB's existing "nrl" sport row if one exists (it does, in any real
  // Perfect 2 dev DB with later phases' data already seeded) rather than assuming a
  // pristine database — sports.code is globally unique.
  const existingSport = (await db.select().from(schema.sports).where(eq(schema.sports.code, "nrl")))[0];
  const sportWasCreatedByThisRun = !existingSport;
  const sport = existingSport ?? (await db.insert(schema.sports).values({ code: "nrl", name: "QA National Rugby League" }).returning())[0];

  // Defensive pre-flight: a previous run that crashed before its own cleanup ran can leave
  // a QA season behind at this same fixed (sportId, year=2099) pair, which
  // seasons_sport_year_unique would then reject forever now that the sport row is reused.
  const orphanedSeason = (await db.select().from(schema.seasons).where(and(eq(schema.seasons.sportId, sport.id), eq(schema.seasons.year, 2099))))[0];
  if (orphanedSeason?.label === `${MARK}-season`) {
    console.log(`Pre-flight: removing an orphaned QA season from a previous run (id=${orphanedSeason.id}).`);
    const orphanedRounds = await db.select().from(schema.rounds).where(eq(schema.rounds.seasonId, orphanedSeason.id));
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
    await db.delete(schema.seasons).where(eq(schema.seasons.id, orphanedSeason.id));
  }

  const [season] = await db.insert(schema.seasons).values({ sportId: sport.id, year: 2099, label: `${MARK}-season` }).returning();
  const [round] = await db.insert(schema.rounds).values({ seasonId: season.id, roundNumber: 1, name: `${MARK}-round`, status: "upcoming" }).returning();
  const [homeTeam] = await db.insert(schema.teams).values({ sportId: sport.id, name: `${MARK}-home`, shortName: "QAH", slug: `${MARK}-home` }).returning();
  const [awayTeam] = await db.insert(schema.teams).values({ sportId: sport.id, name: `${MARK}-away`, shortName: "QAA", slug: `${MARK}-away` }).returning();
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const [game] = await db
    .insert(schema.games)
    .values({ roundId: round.id, homeTeamId: homeTeam.id, awayTeamId: awayTeam.id, kickoff: future, status: "scheduled" })
    .returning();
  const [p1] = await db.insert(schema.players).values({ sportId: sport.id, teamId: homeTeam.id, firstName: "QA", lastName: "PlayerOne" }).returning();
  const [p2] = await db.insert(schema.players).values({ sportId: sport.id, teamId: awayTeam.id, firstName: "QA", lastName: "PlayerTwo" }).returning();
  await db.insert(schema.gameLineups).values([
    { gameId: game.id, teamId: homeTeam.id, playerId: p1.id, position: "Fullback" },
    { gameId: game.id, teamId: awayTeam.id, playerId: p2.id, position: "Fullback" },
  ]);

  const email = `${MARK}-${Date.now()}@example.com`;
  const token = await registerUser(email);
  const auth = { Authorization: `Bearer ${token}` };
  const userRows = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  const userId = userRows[0].id;

  try {
    const packagesRes = await api("/api/entry-packages");
    assert(packagesRes.status === 200, "GET /api/entry-packages succeeds");
    const packages = packagesRes.body.data.packages as { id: number; entryCount: number; priceCents: number }[];
    assert(packages.length === 3, "exactly 3 active packages seeded (1/5/10)");
    const onePack = packages.find((p) => p.entryCount === 1)!;
    const fivePack = packages.find((p) => p.entryCount === 5)!;
    const tenPack = packages.find((p) => p.entryCount === 10)!;
    assert(onePack.priceCents === 500 && fivePack.priceCents === 2000 && tenPack.priceCents === 3500, "package prices match spec: $5/$20/$35");

    // Insufficient funds before any deposit.
    const insufficientRes = await api(`/api/nrl/rounds/${round.id}/enter-package`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ packageId: onePack.id, selectionsPerEntry: [[{ gameId: game.id, playerIds: [p1.id] }]] }),
    });
    assert(insufficientRes.status === 422 && /Insufficient/.test(insufficientRes.body.message), "purchase with zero balance is rejected as insufficient funds");

    // Real deposits only ever confirm via a payment-provider webhook (see the wallet-
    // crediting fix: a merely "pending" provider result — all the dev provider ever
    // returns — must never credit real spendable balance). This test's purpose is entry-
    // package purchasing, not the deposit-confirmation flow itself (that's covered by
    // scripts/qa-wallet-smoke.ts), so fund the wallet directly the same way every other
    // QA fixture in this codebase does.
    const depositRes = await api("/api/me/wallet/deposit", { method: "POST", headers: auth, body: JSON.stringify({ amountCents: 10_000 }) });
    assert(depositRes.status === 200 && depositRes.body.data.confirmed === false, "a deposit attempt is honestly reported as unconfirmed — no real payment provider is connected");
    await db.insert(schema.wallets).values({ userId, balanceCents: 10_000 }).onConflictDoUpdate({ target: schema.wallets.userId, set: { balanceCents: 10_000 } });

    const fivePurchase = await api(`/api/nrl/rounds/${round.id}/enter-package`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        packageId: fivePack.id,
        selectionsPerEntry: Array.from({ length: 5 }, () => [{ gameId: game.id, playerIds: [p1.id] }]),
      }),
    });
    assert(fivePurchase.status === 201, "5-entry package purchase succeeds");
    assert(fivePurchase.body.data.entryIds.length === 5, "exactly 5 independent entries were created");
    assert(fivePurchase.body.data.amountPaidCents === 2000, "amount paid is $20 (the package price), not 5x$5=$25");
    assert(fivePurchase.body.data.newBalanceCents === 8000, "wallet balance after purchase is $80 ($100 - $20)");

    const balanceRes = await api("/api/me/wallet", { headers: auth });
    assert(balanceRes.body.data.balanceCents === 8000, "GET /api/me/wallet reflects the same $80 balance");

    const entryRows = await db
      .select()
      .from(schema.competitionEntries)
      .where(and(eq(schema.competitionEntries.userId, userId)));
    assert(entryRows.length === 5, "exactly 5 competition_entries rows exist in the DB");
    assert(entryRows.every((e) => e.paidAmountCents === 400), "each of the 5 entries individually attributes $4.00 ($20/5) as paidAmountCents");
    assert(new Set(entryRows.map((e) => e.result)).size === 1 && entryRows[0].result === "pending", "every entry starts pending, independently trackable");

    const ledgerRows = await db.select().from(schema.walletTransactions).where(eq(schema.walletTransactions.userId, userId));
    const purchaseTx = ledgerRows.find((t) => t.type === "entry_purchase");
    assert(!!purchaseTx, "exactly one entry_purchase ledger row exists");
    assert(purchaseTx!.amountCents === -2000, "the ledger row records ONE debit of -$20, never 5 separate -$5 debits");
    assert(Array.isArray(purchaseTx!.relatedEntryIds) && (purchaseTx!.relatedEntryIds as number[]).length === 5, "the ledger row is linked to all 5 entries it paid for");

    const myEntriesRes = await api(`/api/nrl/rounds/${round.id}/entries`, { headers: auth });
    assert(myEntriesRes.status === 200, "GET .../entries (my entries in this round) succeeds");
    assert(myEntriesRes.body.data.entries.length === 5, "the round's entries endpoint lists all 5 independent entries");
    assert(myEntriesRes.body.data.maxEntries === 10, "the round reports the configured max of 10 entries");

    // Cap enforcement: 5 existing + a 10-pack (15) exceeds the max of 10.
    const overCapRes = await api(`/api/nrl/rounds/${round.id}/enter-package`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        packageId: tenPack.id,
        selectionsPerEntry: Array.from({ length: 10 }, () => [{ gameId: game.id, playerIds: [p1.id] }]),
      }),
    });
    assert(overCapRes.status === 422, "purchasing a 10-pack when 5 entries already exist (would total 15) is rejected");
    assert(/maximum of 10 entries/.test(overCapRes.body.errors?.[0] ?? ""), "the cap-rejection message names the configured max (10)");

    const balanceAfterRejectedRes = await api("/api/me/wallet", { headers: auth });
    assert(balanceAfterRejectedRes.body.data.balanceCents === 8000, "a cap-rejected purchase never touches the wallet balance");

    // Exactly-at-cap: 5 existing + a 5-pack (10) is allowed.
    const exactCapPurchase = await api(`/api/nrl/rounds/${round.id}/enter-package`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        packageId: fivePack.id,
        selectionsPerEntry: Array.from({ length: 5 }, () => [{ gameId: game.id, playerIds: [p1.id] }]),
      }),
    });
    assert(exactCapPurchase.status === 201, "purchasing exactly up to the cap (5+5=10) succeeds");

    const oneMoreRes = await api(`/api/nrl/rounds/${round.id}/enter-package`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ packageId: onePack.id, selectionsPerEntry: [[{ gameId: game.id, playerIds: [p1.id] }]] }),
    });
    assert(oneMoreRes.status === 422, "purchasing beyond the cap (10+1) is rejected once the user is exactly at the max");

    // Mismatched selectionsPerEntry length is rejected before any wallet debit.
    const balanceBeforeMismatch = (await api("/api/me/wallet", { headers: auth })).body.data.balanceCents;
    const mismatchRes = await api(`/api/nrl/rounds/${round.id}/enter-package`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ packageId: fivePack.id, selectionsPerEntry: [[{ gameId: game.id, playerIds: [p1.id] }]] }),
    });
    assert(mismatchRes.status === 422, "submitting fewer selection-sets than the package's entry count is rejected");
    const balanceAfterMismatch = (await api("/api/me/wallet", { headers: auth })).body.data.balanceCents;
    assert(balanceAfterMismatch === balanceBeforeMismatch, "the rejected mismatched-package request never touched the wallet");

    console.log(`\n=== PHASE 23 ENTRY-PACKAGES QA: ${passed} checks passed ===`);
  } finally {
    console.log("Cleaning up QA data...");
    const entryIds = (await db.select({ id: schema.competitionEntries.id }).from(schema.competitionEntries).where(eq(schema.competitionEntries.userId, userId))).map((e) => e.id);
    if (entryIds.length) {
      for (const id of entryIds) {
        await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, id));
      }
      await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.userId, userId));
    }
    await db.delete(schema.walletTransactions).where(eq(schema.walletTransactions.userId, userId));
    await db.delete(schema.wallets).where(eq(schema.wallets.userId, userId));
    await db.delete(schema.paymentTransactions).where(eq(schema.paymentTransactions.userId, userId));
    await db.delete(schema.competitions).where(eq(schema.competitions.roundId, round.id));
    await db.delete(schema.gameLineups).where(eq(schema.gameLineups.gameId, game.id));
    await db.delete(schema.games).where(eq(schema.games.id, game.id));
    // Delete only the specific players/teams THIS run created — sport.id is now the real,
    // shared "nrl" sport (reused, not created by this run), so filtering by sportId alone
    // would delete every other real/other-QA team and player under that sport too.
    await db.delete(schema.players).where(eq(schema.players.id, p1.id));
    await db.delete(schema.players).where(eq(schema.players.id, p2.id));
    await db.delete(schema.teams).where(eq(schema.teams.id, homeTeam.id));
    await db.delete(schema.teams).where(eq(schema.teams.id, awayTeam.id));
    await db.delete(schema.rounds).where(eq(schema.rounds.id, round.id));
    await db.delete(schema.seasons).where(eq(schema.seasons.id, season.id));
    // Only remove the sport row if THIS run created it — a reused real "nrl" row is
    // shared reference data, never deleted by a QA script.
    if (sportWasCreatedByThisRun) await db.delete(schema.sports).where(eq(schema.sports.id, sport.id));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));

    const leftoverUser = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    const leftoverSport = sportWasCreatedByThisRun ? await db.select().from(schema.sports).where(eq(schema.sports.id, sport.id)) : [];
    assert(leftoverUser.length === 0 && leftoverSport.length === 0, "cleanup verified: zero rows remain for the QA fixtures");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
