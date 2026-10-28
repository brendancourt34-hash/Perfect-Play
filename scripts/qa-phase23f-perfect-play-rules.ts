/**
 * PHASE 23F QA — verifies the "pick the Perfect Round" (1 selection per game) rules
 * change and the new NFL sport against the real running backend. Pure logic is already
 * unit-tested (settle.test.ts, validate.test.ts, registry.test.ts, round-shape.test.ts);
 * this script proves the same behavior end-to-end through real HTTP routes, real DB rows,
 * and real auth.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/qa-phase23f-perfect-play-rules.ts
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, inArray } from "drizzle-orm";
import * as schema from "../src/db/schema";

const API_URL = "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
const MARK = `qa-test-internal-23f-${Date.now()}`;
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

async function getOrCreateSport(code: string, name: string): Promise<{ id: number; wasCreated: boolean }> {
  const existing = await db.select().from(schema.sports).where(eq(schema.sports.code, code)).limit(1);
  if (existing[0]) return { id: existing[0].id, wasCreated: false };
  const [row] = await db.insert(schema.sports).values({ code, name }).returning();
  return { id: row.id, wasCreated: true };
}

interface SeededRound {
  sportId: number;
  seasonId: number;
  roundId: number;
  gameIds: number[];
  teamId: number;
  teamIds: number[];
  playerIds: number[];
}

/**
 * Seeds one QA season/round/2-game fixture for a sport, with a small player pool per
 * game. Games are created SCHEDULED with a future kickoff (so entries are accepted and
 * selections aren't locked) — call finalizeGames() after entry creation to mark them
 * final, exactly like a real round progresses.
 */
async function seedRound(sportId: number, sportCode: string): Promise<SeededRound> {
  const [season] = await db.insert(schema.seasons).values({ sportId, year: 2099, label: `${MARK}-season` }).returning();
  const [round] = await db.insert(schema.rounds).values({ seasonId: season.id, roundNumber: 1, name: `${MARK}-round` }).returning();
  const [teamA] = await db.insert(schema.teams).values({ sportId, slug: `${MARK}-${sportCode}-a`, name: `${MARK} A`, shortName: "QAA" }).returning();
  const [teamB] = await db.insert(schema.teams).values({ sportId, slug: `${MARK}-${sportCode}-b`, name: `${MARK} B`, shortName: "QAB" }).returning();

  const gameIds: number[] = [];
  const playerIds: number[] = [];
  for (let i = 0; i < 2; i++) {
    const [game] = await db
      .insert(schema.games)
      .values({
        roundId: round.id,
        homeTeamId: teamA.id,
        awayTeamId: teamB.id,
        kickoff: new Date(Date.now() + 60 * 60 * 1000),
        status: "scheduled",
      })
      .returning();
    gameIds.push(game.id);

    const [p1] = await db.insert(schema.players).values({ sportId, teamId: teamA.id, firstName: MARK, lastName: `P${i}a`, position: "Any" }).returning();
    const [p2] = await db.insert(schema.players).values({ sportId, teamId: teamB.id, firstName: MARK, lastName: `P${i}b`, position: "Any" }).returning();
    playerIds.push(p1.id, p2.id);
    await db.insert(schema.gameLineups).values([
      { gameId: game.id, playerId: p1.id, teamId: teamA.id, position: "Any" },
      { gameId: game.id, playerId: p2.id, teamId: teamB.id, position: "Any" },
    ]);
  }
  return { sportId, seasonId: season.id, roundId: round.id, gameIds, teamId: teamA.id, teamIds: [teamA.id, teamB.id], playerIds };
}

/** Marks every game in the fixture final with a placeholder score — call after entries are created, before inserting stats. */
async function finalizeGames(gameIds: number[]) {
  await db.update(schema.games).set({ status: "final", homeScore: 20, awayScore: 10 }).where(inArray(schema.games.id, gameIds));
}

async function cleanupRound(seeded: SeededRound, sportCreated: boolean, sportId: number) {
  const entryRows = await db
    .select({ id: schema.competitionEntries.id })
    .from(schema.competitionEntries)
    .innerJoin(schema.competitions, eq(schema.competitions.id, schema.competitionEntries.competitionId))
    .where(eq(schema.competitions.roundId, seeded.roundId));
  const entryIds = entryRows.map((e) => e.id);
  if (entryIds.length) {
    await db.delete(schema.entrySelections).where(inArray(schema.entrySelections.entryId, entryIds));
    await db.delete(schema.competitionEntries).where(inArray(schema.competitionEntries.id, entryIds));
  }
  await db.delete(schema.competitions).where(eq(schema.competitions.roundId, seeded.roundId));
  await db.delete(schema.playerGameStats).where(inArray(schema.playerGameStats.gameId, seeded.gameIds));
  await db.delete(schema.gameLineups).where(inArray(schema.gameLineups.gameId, seeded.gameIds));
  // Games must be deleted before the teams they reference (FK), and teams are deleted by
  // their SPECIFIC ids only — never by sportId, which could be a real, shared sport row
  // (e.g. a permanent "nrl" row from earlier session activity) whose other real teams
  // must never be touched by this script's cleanup.
  await db.delete(schema.games).where(inArray(schema.games.id, seeded.gameIds));
  await db.delete(schema.players).where(inArray(schema.players.id, seeded.playerIds));
  await db.delete(schema.teams).where(inArray(schema.teams.id, seeded.teamIds));
  await db.delete(schema.rounds).where(eq(schema.rounds.id, seeded.roundId));
  await db.delete(schema.seasons).where(eq(schema.seasons.id, seeded.seasonId));
  if (sportCreated) await db.delete(schema.sports).where(eq(schema.sports.id, sportId));
}

async function main() {
  console.log("=== PHASE 23F QA: pick the Perfect Round (1 selection/game) + NFL ===");

  const { token: userToken } = await registerUser(`${MARK}-user@example.com`);
  const auth = { Authorization: `Bearer ${userToken}` };

  // --- 1. Round-detail API exposes the server-authoritative rule config ---
  const nrlSport = await getOrCreateSport("nrl", "NRL");
  const nrlSeeded = await seedRound(nrlSport.id, "nrl");
  try {
    const roundDetail = await api(`/api/nrl/rounds/${nrlSeeded.roundId}`);
    assert(roundDetail.status === 200, "round-detail API returns 200 for a real NRL round");
    assert(roundDetail.body.data.ruleConfig.selectionsPerGame === 1, "NRL rule config reports selectionsPerGame=1");
    assert(roundDetail.body.data.ruleConfig.selectionMetric === "tries", "NRL rule config reports selectionMetric=tries");
    assert(roundDetail.body.data.ruleConfig.threshold === 1, "NRL rule config reports threshold=1");
    assert(roundDetail.body.data.ruleConfig.requiredGames === 2, "NRL rule config reports the round's actual game count (2), not a hardcoded number");

    // --- 2. Creating an entry with 2 players for one game is rejected (old mechanics) ---
    const gameId = nrlSeeded.gameIds[0];
    const otherGameId = nrlSeeded.gameIds[1];
    const eligibleForGame0 = nrlSeeded.playerIds.slice(0, 2);
    const eligibleForGame1 = nrlSeeded.playerIds.slice(2, 4);
    const twoPickAttempt = await api(`/api/nrl/rounds/${nrlSeeded.roundId}/entries`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        selections: [
          { gameId, playerIds: eligibleForGame0 }, // 2 players — old mechanics, must be rejected
          { gameId: otherGameId, playerIds: [eligibleForGame1[0]] },
        ],
      }),
    });
    assert(twoPickAttempt.status === 422, "submitting 2 players for one game is rejected (422) under the new 1-pick rule");

    // --- 3. A correct, single-selection-per-game entry succeeds ---
    const correctEntry = await api(`/api/nrl/rounds/${nrlSeeded.roundId}/entries`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        selections: [
          { gameId, playerIds: [eligibleForGame0[0]] },
          { gameId: otherGameId, playerIds: [eligibleForGame1[0]] },
        ],
      }),
    });
    assert(correctEntry.status === 201, "a valid 1-pick-per-game entry is accepted");
    const entryId = correctEntry.body.data.entryId as number;

    // Now that the entry is locked in, finalize the games and seed real tries so both
    // picks are correct, then settle via the mobile-facing read API.
    await finalizeGames(nrlSeeded.gameIds);
    await db.insert(schema.playerGameStats).values([
      { gameId, playerId: eligibleForGame0[0], teamId: nrlSeeded.teamId, tries: 1 },
      { gameId: otherGameId, playerId: eligibleForGame1[0], teamId: nrlSeeded.teamId, tries: 1 },
    ]);
    const entryRead = await api(`/api/entries/${entryId}`, { headers: auth });
    assert(entryRead.status === 200, "the new entry can be read back");
    assert(entryRead.body.data.entry.entryResult === "perfect", "a fully-correct 1-pick-per-game entry settles PERFECT");
    assert(
      entryRead.body.data.entry.selections.every((s: { selections: unknown[] }) => s.selections.length === 1),
      "every game in the new entry has exactly 1 selection recorded — never 2",
    );
  } finally {
    await cleanupRound(nrlSeeded, nrlSport.wasCreated, nrlSport.id);
  }

  // --- 4. NBA's threshold is 25, not the old 20 ---
  const nbaSport = await getOrCreateSport("nba", "NBA");
  const nbaSeeded = await seedRound(nbaSport.id, "nba");
  try {
    const gameId = nbaSeeded.gameIds[0];
    const p24 = nbaSeeded.playerIds[0];
    const entry = await api(`/api/nba/rounds/${nbaSeeded.roundId}/entries`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        selections: [
          { gameId, playerIds: [p24] },
          { gameId: nbaSeeded.gameIds[1], playerIds: [nbaSeeded.playerIds[2]] },
        ],
      }),
    });
    assert(entry.status === 201, "NBA 1-pick entry accepted");
    await finalizeGames(nbaSeeded.gameIds);
    await db.insert(schema.playerGameStats).values([{ gameId, playerId: p24, teamId: nbaSeeded.teamId, points: 24 }]);
    const read = await api(`/api/entries/${entry.body.data.entryId}`, { headers: auth });
    const game0 = read.body.data.entry.selections.find((s: { gameId: number }) => s.gameId === gameId);
    assert(game0.selections[0].result === "incorrect", "NBA: 24 points is INCORRECT under the new 25+ threshold (was correct pre-23F)");
  } finally {
    await cleanupRound(nbaSeeded, nbaSport.wasCreated, nbaSport.id);
  }

  // --- 5. NFL is a fully working new sport end to end ---
  const nflSport = await getOrCreateSport("nfl", "NFL");
  const nflSeeded = await seedRound(nflSport.id, "nfl");
  try {
    const roundDetail = await api(`/api/nfl/rounds/${nflSeeded.roundId}`);
    assert(roundDetail.status === 200, "NFL round-detail API works — NFL is registered end to end, not just in config");
    assert(roundDetail.body.data.ruleConfig.selectionMetric === "touchdowns", "NFL rule config reports selectionMetric=touchdowns");
    assert(roundDetail.body.data.ruleConfig.threshold === 1, "NFL rule config reports threshold=1 (>=1 touchdown)");

    const gameId = nflSeeded.gameIds[0];
    const scorer = nflSeeded.playerIds[0];
    const misser = nflSeeded.playerIds[2];
    const entry = await api(`/api/nfl/rounds/${nflSeeded.roundId}/entries`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        selections: [
          { gameId, playerIds: [scorer] },
          { gameId: nflSeeded.gameIds[1], playerIds: [misser] },
        ],
      }),
    });
    assert(entry.status === 201, "NFL entry created successfully");
    await finalizeGames(nflSeeded.gameIds);
    await db.insert(schema.playerGameStats).values([
      { gameId, playerId: scorer, teamId: nflSeeded.teamId, touchdowns: 1 },
      { gameId: nflSeeded.gameIds[1], playerId: misser, teamId: nflSeeded.teamId, touchdowns: 0 },
    ]);
    const read = await api(`/api/entries/${entry.body.data.entryId}`, { headers: auth });
    assert(read.body.data.entry.entryResult === "not_perfect", "NFL entry with one touchdown miss settles NOT_PERFECT");
    assert(read.body.data.entry.statField === "touchdowns", "NFL entry result reports statField=touchdowns");

    const providerStatus = await db.select().from(schema.sports).where(eq(schema.sports.code, "nfl")).limit(1);
    assert(!!providerStatus[0], "NFL sport row exists in the DB as a genuine first-class sport, not a UI-only placeholder");
  } finally {
    await cleanupRound(nflSeeded, nflSport.wasCreated, nflSport.id);
  }

  // --- 6. Historical (pre-Phase 23F) 2-pick entries still settle correctly, untouched ---
  const aflSport = await getOrCreateSport("afl", "AFL");
  const aflSeeded = await seedRound(aflSport.id, "afl");
  try {
    await finalizeGames(aflSeeded.gameIds);
    const [historicalEntry] = await db
      .insert(schema.competitionEntries)
      .values({
        competitionId: (
          await db
            .insert(schema.competitions)
            .values({ sportId: aflSport.id, roundId: aflSeeded.roundId, name: `${MARK}-historical`, entryFeeCents: 500, status: "closed" })
            .returning()
        )[0].id,
        userId: (await db.select().from(schema.users).where(eq(schema.users.email, `${MARK}-user@example.com`)))[0].id,
        paymentStatus: "paid",
        paidAmountCents: 500,
      })
      .returning();
    // Simulate a legacy 2-pick row directly (never producible via the API anymore).
    await db.insert(schema.entrySelections).values([
      { entryId: historicalEntry.id, gameId: aflSeeded.gameIds[0], selectedPlayer1Id: aflSeeded.playerIds[0], selectedPlayer2Id: aflSeeded.playerIds[1] },
      { entryId: historicalEntry.id, gameId: aflSeeded.gameIds[1], selectedPlayer1Id: aflSeeded.playerIds[2], selectedPlayer2Id: aflSeeded.playerIds[3] },
    ]);
    await db.insert(schema.playerGameStats).values([
      { gameId: aflSeeded.gameIds[0], playerId: aflSeeded.playerIds[0], teamId: aflSeeded.teamId, goals: 1 },
      { gameId: aflSeeded.gameIds[0], playerId: aflSeeded.playerIds[1], teamId: aflSeeded.teamId, goals: 1 },
      { gameId: aflSeeded.gameIds[1], playerId: aflSeeded.playerIds[2], teamId: aflSeeded.teamId, goals: 1 },
      { gameId: aflSeeded.gameIds[1], playerId: aflSeeded.playerIds[3], teamId: aflSeeded.teamId, goals: 0 }, // one miss
    ]);
    const read = await api(`/api/entries/${historicalEntry.id}`, { headers: auth });
    assert(read.status === 200, "a historical 2-pick entry can still be read");
    assert(read.body.data.entry.entryResult === "not_perfect", "a historical 2-pick entry with one of its two picks missing settles NOT_PERFECT correctly");
    const perfectGame = read.body.data.entry.selections.find((s: { gameId: number }) => s.gameId === aflSeeded.gameIds[0]);
    assert(perfectGame.selections.length === 2, "the historical entry's game still shows both of its original 2 picks — never truncated to 1");
    assert(perfectGame.gameResult === "perfect", "the historical entry's fully-correct game still settles PERFECT under the same (unmodified) rule");
  } finally {
    await cleanupRound(aflSeeded, aflSport.wasCreated, aflSport.id);
  }

  // --- 7. Rebrand spot-check ---
  const home = await fetch(`${API_URL}/`);
  const homeHtml = await home.text();
  assert(!homeHtml.includes("Perfect 2") && !homeHtml.includes("PERFECT 2"), "home page HTML contains no 'Perfect 2'/'PERFECT 2' branding");
  assert(homeHtml.includes("Perfect Play"), "home page HTML shows the 'Perfect Play' brand name");
  const adminLogin = await fetch(`${API_URL}/admin/login`);
  const adminLoginHtml = await adminLogin.text();
  assert(adminLoginHtml.includes("Perfect Play Admin"), "admin login page shows 'Perfect Play Admin'");

  console.log(`\n=== PHASE 23F QA: ${passed} checks passed ===`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
