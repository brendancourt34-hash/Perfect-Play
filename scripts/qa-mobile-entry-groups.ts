/**
 * QA — Mobile My Entries grouping (GET /api/entries/groups), the same data shape/grouping
 * algorithm as the web My Entries page (listEntryGroupsForUser) exposed for mobile. Buys
 * 1/5/10-entry packages across three DIFFERENT sports (NRL 8 games, AFL 9 games, NBA 8
 * games) for the SAME customer, then verifies: correct entry counts per group, shared
 * picks shown exactly once per group (never once per entry), multiple groups for one
 * customer, per-sport game counts are never hard-coded, and settled PERFECT/NOT-PERFECT/
 * pending outcomes with the correct payout.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/qa-mobile-entry-groups.ts
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "../src/db";
import { createLoadTestRound, cleanupLoadTestFixture, type LoadTestRoundFixture, type LoadTestUser } from "./loadtest/fixtures";
import { purchaseEntryPackage } from "../src/lib/data/entry-packages";
import { closeCompetition } from "../src/lib/data/competitions";
import { settleCompetition } from "../src/lib/data/settlement";

const db = getDb();
const API_URL = "http://localhost:3000";
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

async function buyPackage(userId: number, sportId: number, sportCode: string, roundId: number, mark: string, entryCount: 1 | 5 | 10, selections: { gameId: number; playerIds: number[] }[]) {
  const [pkg] = await db.select().from(schema.entryPackages).where(eq(schema.entryPackages.entryCount, entryCount)).limit(1);
  await db.insert(schema.wallets).values({ userId, balanceCents: pkg.priceCents }).onConflictDoUpdate({ target: schema.wallets.userId, set: { balanceCents: pkg.priceCents } });
  return purchaseEntryPackage({ sportId, sportCode, competitionName: mark, roundId, userId, packageId: pkg.id, selections, idempotencyKey: `${mark}-buy` });
}

async function finalizeAllCorrect(fixture: LoadTestRoundFixture, statField: "tries" | "goals" | "points" | "touchdowns") {
  for (const g of fixture.games) {
    const [game] = await db.select().from(schema.games).where(eq(schema.games.id, g.id)).limit(1);
    await db.update(schema.games).set({ status: "final", homeScore: 20, awayScore: 10 }).where(eq(schema.games.id, g.id));
    await db.insert(schema.playerGameStats).values({ gameId: g.id, playerId: g.scorerId, teamId: game.homeTeamId, [statField]: statField === "points" ? 30 : 1 });
  }
}

async function finalizeOneWrong(fixture: LoadTestRoundFixture) {
  for (const g of fixture.games) {
    await db.update(schema.games).set({ status: "final", homeScore: 20, awayScore: 10 }).where(eq(schema.games.id, g.id));
  }
  // No player_game_stats rows at all -> every pick settles "incorrect" (missing row = 0, see settle.ts).
}

async function main() {
  const mark = `qa-mobile-groups-${Date.now()}`;
  const nrl = await createLoadTestRound("nrl", `${mark}-nrl`);
  const afl = await createLoadTestRound("afl", `${mark}-afl`);
  const nba = await createLoadTestRound("nba", `${mark}-nba`);

  const reg = await fetch(`${API_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${mark}@example.com`, password: "qa-mobile-groups-pw-1", name: "Mobile Groups QA" }),
  });
  const regBody = await reg.json();
  const userId = regBody.data.user.id as number;
  const token = regBody.data.token as string;

  const sportIds = new Map<string, number>();
  for (const code of ["nrl", "afl", "nba"]) {
    sportIds.set(code, (await db.select().from(schema.sports).where(eq(schema.sports.code, code)).limit(1))[0].id);
  }

  const nrlSelections = nrl.games.map((g) => ({ gameId: g.id, playerIds: [g.scorerId] }));
  const aflSelections = afl.games.map((g) => ({ gameId: g.id, playerIds: [g.scorerId] }));
  const nbaSelections = nba.games.map((g) => ({ gameId: g.id, playerIds: [g.scorerId] }));

  console.log("=== Buying 1/5/10-entry packages across three different sports for one customer ===");
  const purchaseNrl = await buyPackage(userId, sportIds.get("nrl")!, "nrl", nrl.roundId, `${mark}-nrl`, 1, nrlSelections);
  const purchaseAfl = await buyPackage(userId, sportIds.get("afl")!, "afl", afl.roundId, `${mark}-afl`, 5, aflSelections);
  const purchaseNba = await buyPackage(userId, sportIds.get("nba")!, "nba", nba.roundId, `${mark}-nba`, 10, nbaSelections);
  check("NRL 1-entry package purchased", purchaseNrl.status === "ok" && purchaseNrl.entryCount === 1, purchaseNrl);
  check("AFL 5-entry package purchased", purchaseAfl.status === "ok" && purchaseAfl.entryCount === 5, purchaseAfl);
  check("NBA 10-entry package purchased", purchaseNba.status === "ok" && purchaseNba.entryCount === 10, purchaseNba);

  console.log("\n=== GET /api/entries/groups — verifying grouping before settlement ===");
  const groupsRes1 = await fetch(`${API_URL}/api/entries/groups`, { headers: { Authorization: `Bearer ${token}` } });
  const groupsBody1 = await groupsRes1.json();
  check("groups endpoint returns 200", groupsRes1.status === 200, groupsBody1);
  const groups1 = groupsBody1.data.groups as { competitionId: number; sportCode: string; entryIds: number[]; result: string; selections: unknown[] }[];
  check("exactly 3 groups exist for this customer (multiple groups, one per competition)", groups1.length === 3, groups1);

  const gNrl = groups1.find((g) => g.sportCode === "nrl");
  const gAfl = groups1.find((g) => g.sportCode === "afl");
  const gNba = groups1.find((g) => g.sportCode === "nba");
  check("NRL group has exactly 1 entry", gNrl?.entryIds.length === 1, gNrl);
  check("AFL group has exactly 5 entries", gAfl?.entryIds.length === 5, gAfl);
  check("NBA group has exactly 10 entries", gNba?.entryIds.length === 10, gNba);
  check("NRL selections shown ONCE (8 games), never once per entry", gNrl?.selections.length === 8, gNrl?.selections.length);
  check("AFL selections shown ONCE (9 games, not hard-coded to 8), never 5x", gAfl?.selections.length === 9, gAfl?.selections.length);
  check("NBA selections shown ONCE (8 games), never 10x", gNba?.selections.length === 8, gNba?.selections.length);
  check("all three groups start PENDING", gNrl?.result === "pending" && gAfl?.result === "pending" && gNba?.result === "pending", { gNrl: gNrl?.result, gAfl: gAfl?.result, gNba: gNba?.result });

  async function competitionIdForEntry(entryId: number): Promise<number> {
    const [entry] = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId)).limit(1);
    return entry.competitionId;
  }
  const nrlCompetitionId = purchaseNrl.status === "ok" ? await competitionIdForEntry(purchaseNrl.entryIds[0]) : -1;
  const aflCompetitionId = purchaseAfl.status === "ok" ? await competitionIdForEntry(purchaseAfl.entryIds[0]) : -1;

  console.log("\n=== Settling: NRL all-correct (PERFECT), AFL one-wrong (NOT PERFECT), NBA left pending ===");
  await finalizeAllCorrect(nrl, "tries");
  await closeCompetition(nrlCompetitionId);
  await settleCompetition(nrlCompetitionId);

  await finalizeOneWrong(afl);
  await closeCompetition(aflCompetitionId);
  await settleCompetition(aflCompetitionId);

  const groupsRes2 = await fetch(`${API_URL}/api/entries/groups`, { headers: { Authorization: `Bearer ${token}` } });
  const groups2 = (await groupsRes2.json()).data.groups as { sportCode: string; result: string; totalPrizeAllocationCents: number; competitionWinnerCount: number }[];
  const gNrl2 = groups2.find((g) => g.sportCode === "nrl");
  const gAfl2 = groups2.find((g) => g.sportCode === "afl");
  const gNba2 = groups2.find((g) => g.sportCode === "nba");
  check("NRL group is now PERFECT with a real payout (1 share)", gNrl2?.result === "perfect" && (gNrl2?.totalPrizeAllocationCents ?? 0) > 0, gNrl2);
  check("AFL group is now NOT_PERFECT with zero payout", gAfl2?.result === "not_perfect" && gAfl2?.totalPrizeAllocationCents === 0, gAfl2);
  check("NBA group is still PENDING (never settled)", gNba2?.result === "pending", gNba2);

  // Cleanup
  await db.delete(schema.perfectPlayMoments).where(eq(schema.perfectPlayMoments.competitionId, nrlCompetitionId));
  await db.delete(schema.perfectPlayMoments).where(eq(schema.perfectPlayMoments.competitionId, aflCompetitionId));
  await cleanupLoadTestFixture(nrl, []);
  await cleanupLoadTestFixture(afl, []);
  await cleanupLoadTestFixture(nba, []);
  await db.delete(schema.paymentTransactions).where(eq(schema.paymentTransactions.userId, userId));
  await db.delete(schema.walletTransactions).where(eq(schema.walletTransactions.userId, userId));
  await db.delete(schema.wallets).where(eq(schema.wallets.userId, userId));
  const sessions = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId));
  for (const s of sessions) await db.delete(schema.sessions).where(eq(schema.sessions.id, s.id));
  await db.delete(schema.users).where(eq(schema.users.id, userId));

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
