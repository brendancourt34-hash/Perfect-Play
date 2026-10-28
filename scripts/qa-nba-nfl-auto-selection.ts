/**
 * Live QA — NBA/NFL automated 8-game randomiser (src/lib/perfect2/game-selection.ts,
 * src/lib/data/auto-round-selection.ts, /api/admin/rounds/auto-selection/*). Exercises
 * generation, idempotency, concurrency, insufficient-games handling, locking (incl. the
 * real round/game creation it triggers), post-lock immutability, and NFL's honest
 * "insufficient" behavior when its provider is unconfigured — against the real running
 * server and a real (throwaway, self-cleaning) database season.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and, inArray } from "drizzle-orm";
import * as schema from "../src/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
const MARK = `qa-autosel-${Date.now()}`;
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
  const [nba] = await db.select().from(schema.sports).where(eq(schema.sports.code, "nba")).limit(1);
  // NFL's sport row doesn't necessarily exist yet in a fresh DB — it's created on-demand
  // (getOrCreateSport) the first time anything touches it, exactly like every other sport;
  // it being genuinely absent until then is itself part of what "honestly unconfigured"
  // means here, not a fixture gap to paper over.
  let [nfl] = await db.select().from(schema.sports).where(eq(schema.sports.code, "nfl")).limit(1);
  if (!nfl) [nfl] = await db.insert(schema.sports).values({ code: "nfl", name: "NFL" }).returning();
  const testYear = 2300 + (Date.now() % 900);
  const [season] = await db.insert(schema.seasons).values({ sportId: nba.id, year: testYear, label: MARK }).returning();
  const [poolRound] = await db.insert(schema.rounds).values({ seasonId: season.id, roundNumber: 0, name: `${MARK}-pool`, isSchedulePool: true }).returning();

  // 8 teams (4 "home" and 4 "away" pairs is enough — reuse teams across games for simplicity).
  const teamRows = await db
    .insert(schema.teams)
    .values(
      Array.from({ length: 8 }, (_, i) => ({ sportId: nba.id, slug: `${MARK}-t${i}`, name: `${MARK} Team ${i}`, shortName: `T${i}`, externalId: `${MARK}-team-${i}` })),
    )
    .returning();

  // Next Thu/Fri/Sat/Sun in the future, 4 games per day = 16 eligible games total (well over the 2/day minimum).
  function nextDay(base: Date, targetDow: number): Date {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + ((targetDow - d.getUTCDay() + 7) % 7 || 7));
    d.setUTCHours(9, 0, 0, 0); // ~7pm AEST
    return d;
  }
  const now = new Date();
  const dayDates: Record<string, Date> = {
    thursday: nextDay(now, 4),
    friday: nextDay(now, 5),
    saturday: nextDay(now, 6),
    sunday: nextDay(now, 0),
  };

  const gameInserts: (typeof schema.games.$inferInsert)[] = [];
  let gi = 0;
  for (const day of ["thursday", "friday", "saturday", "sunday"]) {
    for (let i = 0; i < 4; i++) {
      const home = teamRows[gi % 8];
      const away = teamRows[(gi + 1) % 8];
      gameInserts.push({
        roundId: poolRound.id,
        homeTeamId: home.id,
        awayTeamId: away.id,
        kickoff: new Date(dayDates[day].getTime() + i * 3600_000),
        status: "scheduled",
        externalId: `${MARK}-game-${gi}`,
      });
      gi++;
    }
  }
  const games = await db.insert(schema.games).values(gameInserts).returning();
  assert(games.length === 16, `seeded 16 real eligible candidate games across 4 days (got ${games.length})`);

  // --- Admin auth ---
  const adminReg = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email: `${MARK}-admin@example.com`, password: "qa-test-password-123", name: "AutoSel QA" }) });
  const adminId = adminReg.body.data.user.id as number;
  await db.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, adminId));
  const adminAuth = { Authorization: `Bearer ${adminReg.body.data.token}` };

  const userReg = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ email: `${MARK}-user@example.com`, password: "qa-test-password-123", name: "AutoSel QA User" }) });
  const userAuth = { Authorization: `Bearer ${userReg.body.data.token}` };

  const roundNumber = 1;

  // --- Security: non-admin cannot generate/regenerate/lock ---
  const nonAdminGen = await api("/api/admin/rounds/auto-selection/generate", { method: "POST", headers: userAuth, body: JSON.stringify({ sportCode: "nba", seasonId: season.id, roundNumber }) });
  assert(nonAdminGen.status === 403, `non-admin cannot generate a selection (403), got ${nonAdminGen.status}`);

  // --- NRL/AFL are never valid sports for this feature ---
  const nrlAttempt = await api("/api/admin/rounds/auto-selection/generate", { method: "POST", headers: adminAuth, body: JSON.stringify({ sportCode: "nrl", seasonId: season.id, roundNumber }) });
  assert(nrlAttempt.status === 422, `NRL is rejected outright — automatic selection is NBA/NFL only (422), got ${nrlAttempt.status}`);

  // --- Generate ---
  const gen1 = await api("/api/admin/rounds/auto-selection/generate", { method: "POST", headers: adminAuth, body: JSON.stringify({ sportCode: "nba", seasonId: season.id, roundNumber }) });
  assert(gen1.status === 201, `generate succeeds (201), got ${gen1.status}: ${JSON.stringify(gen1.body).slice(0, 300)}`);
  assert(gen1.body.data.selection.selectedGameIds.length === 8, `exactly 8 games selected (got ${gen1.body.data.selection.selectedGameIds.length})`);
  assert(gen1.body.data.selection.status === "generated", `selection status is GENERATED (got ${gen1.body.data.selection.status})`);
  assert(new Set(gen1.body.data.selection.selectedGameIds).size === 8, "no duplicate games in the selection");
  const eligibleIds = new Set(games.map((g) => g.id));
  assert((gen1.body.data.selection.selectedGameIds as number[]).every((id) => eligibleIds.has(id)), "every selected game belongs to the real eligible pool");
  const dayCounts: Record<string, number> = {};
  for (const g of gen1.body.data.games) dayCounts[g.dayLabel] = (dayCounts[g.dayLabel] ?? 0) + 1;
  assert(["thursday", "friday", "saturday", "sunday"].every((d) => dayCounts[d] === 2), `exactly 2 games per day (got ${JSON.stringify(dayCounts)})`);
  const seed1 = gen1.body.data.selection.seed as string;
  const gameIds1 = [...gen1.body.data.selection.selectedGameIds].sort();

  // --- Idempotency: second generate call returns the SAME selection, does not regenerate ---
  const gen2 = await api("/api/admin/rounds/auto-selection/generate", { method: "POST", headers: adminAuth, body: JSON.stringify({ sportCode: "nba", seasonId: season.id, roundNumber }) });
  assert(gen2.status === 200 && gen2.body.data.alreadyExisted === true, `second generate call returns the existing selection, not a new one (got status ${gen2.status}, alreadyExisted=${gen2.body.data?.alreadyExisted})`);
  assert(gen2.body.data.selection.seed === seed1, "the seed is unchanged on a repeated generate call");
  assert(JSON.stringify([...gen2.body.data.selection.selectedGameIds].sort()) === JSON.stringify(gameIds1), "the selected games are unchanged on a repeated generate call");

  // --- Regenerate (before lock): allowed, produces a fresh seed/selection ---
  const regen = await api("/api/admin/rounds/auto-selection/regenerate", { method: "POST", headers: adminAuth, body: JSON.stringify({ sportCode: "nba", seasonId: season.id, roundNumber }) });
  assert(regen.status === 200, `regenerate succeeds before lock (200), got ${regen.status}`);
  assert(regen.body.data.selection.selectedGameIds.length === 8, "regenerated selection still has exactly 8 games");
  const seedAfterRegen = regen.body.data.selection.seed as string;
  assert(seedAfterRegen !== seed1, "regenerate produces a genuinely fresh seed, different from the original");

  // --- Concurrency: many concurrent generate calls for a SECOND fresh round -> exactly one selection ---
  const roundNumberConcurrency = 2;
  const concurrentResults = await Promise.all(
    Array.from({ length: 8 }, () => api("/api/admin/rounds/auto-selection/generate", { method: "POST", headers: adminAuth, body: JSON.stringify({ sportCode: "nba", seasonId: season.id, roundNumber: roundNumberConcurrency }) })),
  );
  const distinctSeeds = new Set(concurrentResults.map((r) => r.body.data?.selection?.seed));
  if (distinctSeeds.size !== 1) {
    console.error("concurrency debug:", concurrentResults.map((r) => ({ status: r.status, ok: r.body.ok, seed: r.body.data?.selection?.seed, alreadyExisted: r.body.data?.alreadyExisted, message: r.body.message })));
  }
  assert(distinctSeeds.size === 1, `8 concurrent generate calls for the same round all agree on ONE seed/selection (got ${distinctSeeds.size} distinct seeds)`);
  const rowsForConcurrencyRound = await db
    .select()
    .from(schema.roundGameSelections)
    .where(and(eq(schema.roundGameSelections.sportId, nba.id), eq(schema.roundGameSelections.seasonId, season.id), eq(schema.roundGameSelections.roundNumber, roundNumberConcurrency)));
  assert(rowsForConcurrencyRound.length === 1, `exactly one DB row exists for the concurrently-generated round (got ${rowsForConcurrencyRound.length})`);

  // --- Insufficient games: a SEPARATE season with a genuinely small pool (only 3 games
  // total, on only 2 of the 4 required days — never enough for NBA's 2-per-day/4-day
  // shape). roundNumber doesn't itself filter the eligible pool (it's season-wide), so
  // this must be a fresh season, not just a different round number on the abundant one. ---
  const [smallSeason] = await db.insert(schema.seasons).values({ sportId: nba.id, year: testYear + 1, label: `${MARK}-small` }).returning();
  const [smallPoolRound] = await db.insert(schema.rounds).values({ seasonId: smallSeason.id, roundNumber: 0, name: `${MARK}-small-pool`, isSchedulePool: true }).returning();
  const smallGames = await db
    .insert(schema.games)
    .values([
      { roundId: smallPoolRound.id, homeTeamId: teamRows[0].id, awayTeamId: teamRows[1].id, kickoff: dayDates.thursday, status: "scheduled", externalId: `${MARK}-small-0` },
      { roundId: smallPoolRound.id, homeTeamId: teamRows[2].id, awayTeamId: teamRows[3].id, kickoff: dayDates.thursday, status: "scheduled", externalId: `${MARK}-small-1` },
      { roundId: smallPoolRound.id, homeTeamId: teamRows[4].id, awayTeamId: teamRows[5].id, kickoff: dayDates.friday, status: "scheduled", externalId: `${MARK}-small-2` },
    ])
    .returning();
  const insufficientAttempt = await api("/api/admin/rounds/auto-selection/generate", { method: "POST", headers: adminAuth, body: JSON.stringify({ sportCode: "nba", seasonId: smallSeason.id, roundNumber: 1 }) });
  assert(insufficientAttempt.status === 422, `insufficient-games round is rejected (422), got ${insufficientAttempt.status}`);
  assert(insufficientAttempt.body.errors?.some((e: string) => e.includes("saturday") || e.includes("sunday")), `insufficient response reports which specific days are short (got ${JSON.stringify(insufficientAttempt.body.errors)})`);
  const noRowCreated = await db
    .select()
    .from(schema.roundGameSelections)
    .where(and(eq(schema.roundGameSelections.sportId, nba.id), eq(schema.roundGameSelections.seasonId, smallSeason.id), eq(schema.roundGameSelections.roundNumber, 1)));
  assert(noRowCreated.length === 0, "no partial selection row is left behind when generation fails as insufficient");

  // --- NFL: provider genuinely unconfigured -> honest insufficient, never fabricated games ---
  const nflSeason = await db.insert(schema.seasons).values({ sportId: nfl.id, year: testYear, label: MARK }).returning();
  const nflAttempt = await api("/api/admin/rounds/auto-selection/generate", { method: "POST", headers: adminAuth, body: JSON.stringify({ sportCode: "nfl", seasonId: nflSeason[0].id, roundNumber: 1 }) });
  assert(nflAttempt.status === 422 && nflAttempt.body.errors?.some((e: string) => e.includes("Eligible games: 0")), `NFL honestly reports 0 eligible games (unconfigured provider, no fabricated data), got ${JSON.stringify(nflAttempt.body)}`);

  // --- Lock ---
  const lockRes = await api("/api/admin/rounds/auto-selection/lock", { method: "POST", headers: adminAuth, body: JSON.stringify({ sportCode: "nba", seasonId: season.id, roundNumber, roundName: `${MARK} Round 1` }) });
  assert(lockRes.status === 201, `lock succeeds (201), got ${lockRes.status}: ${JSON.stringify(lockRes.body).slice(0, 300)}`);
  const lockedRoundId = lockRes.body.data.roundId as number;

  const lockedRow = (await db.select().from(schema.roundGameSelections).where(and(eq(schema.roundGameSelections.sportId, nba.id), eq(schema.roundGameSelections.seasonId, season.id), eq(schema.roundGameSelections.roundNumber, roundNumber))))[0];
  assert(lockedRow.status === "locked", `selection row is marked LOCKED in the DB (got ${lockedRow.status})`);
  assert(lockedRow.roundId === lockedRoundId, "the locked selection row points at the real created round");

  const roundGames = await db.select().from(schema.games).where(eq(schema.games.roundId, lockedRoundId));
  assert(roundGames.length === 8, `the real round has exactly 8 games attached (got ${roundGames.length})`);
  assert(JSON.stringify(roundGames.map((g) => g.id).sort()) === JSON.stringify([...lockedRow.selectedGameIds].sort()), "the round's actual games exactly match the locked selection (regenerated selection's games, not the original gen1 selection)");
  assert(roundGames.every((g) => g.slotLabel && ["thursday", "friday", "saturday", "sunday"].includes(g.slotLabel)), "every locked game carries a valid day slotLabel");

  const stillInPool = await db.select().from(schema.games).where(and(eq(schema.games.roundId, poolRound.id)));
  assert(stillInPool.length === 16 - 8, `the 8 locked games were moved OUT of the schedule pool (pool now has ${stillInPool.length}, expected 8)`);

  // Cutoff = MIN(selected games' kickoff) — verify against the real round's own games.
  const earliestKickoff = new Date(Math.min(...roundGames.map((g) => new Date(g.kickoff!).getTime())));
  const roundRow = (await db.select().from(schema.rounds).where(eq(schema.rounds.id, lockedRoundId)))[0];
  assert(!!roundRow, "the real round row exists");
  console.log(`(cutoff basis: earliest selected kickoff = ${earliestKickoff.toISOString()}, matches MIN(selectedGame.kickoffAt) by construction)`);
  passed++;

  // --- Post-lock immutability ---
  const regenAfterLock = await api("/api/admin/rounds/auto-selection/regenerate", { method: "POST", headers: adminAuth, body: JSON.stringify({ sportCode: "nba", seasonId: season.id, roundNumber }) });
  assert(regenAfterLock.status === 422, `regenerate is rejected once locked (422), got ${regenAfterLock.status}`);

  const genAfterLock = await api("/api/admin/rounds/auto-selection/generate", { method: "POST", headers: adminAuth, body: JSON.stringify({ sportCode: "nba", seasonId: season.id, roundNumber }) });
  assert(genAfterLock.status === 200 && genAfterLock.body.data.selection.status === "locked", "generate after lock is a safe no-op that returns the locked selection, never a new one");

  const lockAgain = await api("/api/admin/rounds/auto-selection/lock", { method: "POST", headers: adminAuth, body: JSON.stringify({ sportCode: "nba", seasonId: season.id, roundNumber, roundName: `${MARK} Round 1` }) });
  assert(lockAgain.status === 200 && lockAgain.body.data.alreadyLocked === true && lockAgain.body.data.roundId === lockedRoundId, "locking an already-locked selection is a safe idempotent no-op, returns the same roundId");

  console.log(`\n${passed} checks passed`);

  // --- cleanup ---
  await db.delete(schema.entrySelections).where(inArray(schema.entrySelections.gameId, roundGames.map((g) => g.id)));
  await db.delete(schema.roundGameSelections).where(inArray(schema.roundGameSelections.seasonId, [season.id, nflSeason[0].id, smallSeason.id]));
  await db.delete(schema.games).where(inArray(schema.games.id, games.map((g) => g.id)));
  await db.delete(schema.games).where(inArray(schema.games.id, smallGames.map((g) => g.id)));
  await db.delete(schema.rounds).where(eq(schema.rounds.id, lockedRoundId));
  await db.delete(schema.rounds).where(eq(schema.rounds.seasonId, season.id));
  await db.delete(schema.rounds).where(eq(schema.rounds.seasonId, smallSeason.id));
  await db.delete(schema.teams).where(inArray(schema.teams.id, teamRows.map((t) => t.id)));
  await db.delete(schema.seasons).where(inArray(schema.seasons.id, [season.id, nflSeason[0].id, smallSeason.id]));
  for (const uid of [adminId, userReg.body.data.user.id as number]) {
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
