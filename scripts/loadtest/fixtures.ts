/**
 * Shared fixture setup for load-test scenarios — Phase 23I. Creates a real round with the
 * CURRENT Perfect Play rules' exact game count per sport (never the old Perfect 2
 * two-pick mechanics), and can register many synthetic users in parallel. Every row
 * created here is tagged with a per-run MARK for full, verifiable cleanup afterward,
 * exactly matching every other QA script's convention in this repo.
 */
import { getDb, schema } from "../../src/db";
import { eq, inArray } from "drizzle-orm";
import { withRetry } from "./harness";

/**
 * Every function below optionally accepts an injected `db` (any drizzle Postgres client
 * built against the same schema — the real app's neon-http client, or the isolated
 * load-test client from ./db-client.ts) so the exact same fixture-building logic can
 * target either the shared dev database (the existing CLI's default, unchanged) or a
 * fully separate, disposable database (scripts/loadtest/run-isolated.ts) — never a second,
 * duplicated copy of this logic. `any` is deliberate here: drizzle's neon-http and
 * node-postgres clients are structurally identical for the query-builder calls this file
 * makes, and this is internal test tooling, not application code.
 */
type AnyDb = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const SPORT_GAME_COUNTS: Record<string, number> = { nrl: 8, afl: 9, nba: 8, nfl: 8 };

export interface LoadTestRoundFixture {
  mark: string;
  sportCode: string;
  seasonId: number;
  roundId: number;
  competitionId: number;
  games: { id: number; scorerId: number }[];
  teamIds: number[];
}

/** Ensures the sport row exists (NFL in particular may not exist yet in a fresh DB — created on demand, same as the app itself does). */
async function ensureSport(db: AnyDb, code: string, name: string) {
  const [existing] = await db.select().from(schema.sports).where(eq(schema.sports.code, code)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(schema.sports).values({ code, name }).returning();
  return created;
}

const SPORT_NAMES: Record<string, string> = { nrl: "NRL", afl: "AFL", nba: "NBA", nfl: "NFL" };

/**
 * Builds one real round for `sportCode` with exactly SPORT_GAME_COUNTS[sportCode] games,
 * each with a real, eligible scorer, ready to accept entries (future kickoff, real
 * lineups). This is what every load-test entry submission actually enters.
 *
 * `db` defaults to the real application database client (getDb()) — every existing call
 * site (scripts/loadtest/run.ts's original scenarios) is unaffected. Pass an explicit `db`
 * (e.g. getLoadTestDb() from ./db-client.ts) to build this exact same fixture against a
 * fully separate, isolated database instead — see run-isolated.ts.
 */
export async function createLoadTestRound(sportCode: string, mark: string, db: AnyDb = getDb()): Promise<LoadTestRoundFixture> {
  const gameCount = SPORT_GAME_COUNTS[sportCode];
  if (!gameCount) throw new Error(`Unknown sport code "${sportCode}"`);

  const sport = await ensureSport(db, sportCode, SPORT_NAMES[sportCode]);
  const year = 2900 + (Date.now() % 999);
  const [season] = await db.insert(schema.seasons).values({ sportId: sport.id, year, label: mark }).returning();
  const [round] = await db.insert(schema.rounds).values({ seasonId: season.id, roundNumber: 1, name: mark }).returning();

  const teamIds: number[] = [];
  const games: { id: number; scorerId: number }[] = [];
  for (let i = 0; i < gameCount; i++) {
    const [teamA] = await db.insert(schema.teams).values({ sportId: sport.id, slug: `${mark}-${i}a`, name: `${mark} ${i}A`, shortName: `${i}A` }).returning();
    const [teamB] = await db.insert(schema.teams).values({ sportId: sport.id, slug: `${mark}-${i}b`, name: `${mark} ${i}B`, shortName: `${i}B` }).returning();
    teamIds.push(teamA.id, teamB.id);
    const [game] = await db
      .insert(schema.games)
      .values({ roundId: round.id, homeTeamId: teamA.id, awayTeamId: teamB.id, kickoff: new Date(Date.now() + 3600_000), status: "scheduled" })
      .returning();
    const [scorer] = await db.insert(schema.players).values({ sportId: sport.id, teamId: teamA.id, firstName: mark, lastName: `Scorer${i}`, position: "Any" }).returning();
    await db.insert(schema.gameLineups).values({ gameId: game.id, playerId: scorer.id, teamId: teamA.id, position: "Any" });
    games.push({ id: game.id, scorerId: scorer.id });
  }

  // Force the competition row to exist up front (rather than lazily on first entry) so
  // every concurrent entry attempt races on the SAME already-existing row from the start —
  // the realistic worst case, not an artificially staggered one.
  const [competition] = await db.insert(schema.competitions).values({ sportId: sport.id, roundId: round.id, name: `${mark} competition`, entryFeeCents: 500 }).returning();

  return { mark, sportCode, seasonId: season.id, roundId: round.id, competitionId: competition.id, games, teamIds };
}

export interface LoadTestUser {
  userId: number;
  token: string;
  email: string;
}

/** Registers N synthetic users concurrently (bounded batches to avoid overwhelming the auth endpoint itself, which isn't what we're trying to load-test here). */
export async function registerUsers(baseUrl: string, mark: string, count: number, batchSize = 50): Promise<LoadTestUser[]> {
  const users: LoadTestUser[] = [];
  for (let start = 0; start < count; start += batchSize) {
    const batch = Array.from({ length: Math.min(batchSize, count - start) }, (_, j) => start + j);
    const results = await Promise.all(
      batch.map(async (i) => {
        const email = `${mark}-u${i}@example.com`;
        // withRetry: registration hits the app's own DB (possibly the isolated, network-
        // distant load-test database — see harness.ts's doc comment), which occasionally
        // surfaces a transient "temporarily unavailable" response under this sandbox's
        // flaky outbound connection latency, never a real registration bug.
        const password = "qa-loadtest-password-123";
        const body = await withRetry(async () => {
          const res = await fetch(`${baseUrl}/api/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, name: `Load ${i}` }),
          });
          const parsed = await res.json();
          if (parsed.ok) return parsed;
          // A PRIOR retry attempt can have actually committed the registration even
          // though its response never reached us (this sandbox's connect-phase network
          // flakiness — see db-client.ts's retryingFetch doc comment): only fetch/timeout
          // failures are retried, so if the request's fetch itself failed the write may or
          // may not have landed, and we find out here via "already exists". Logging in
          // instead of re-registering is the idempotent recovery — never a second account.
          const alreadyExists = Array.isArray(parsed.errors) && parsed.errors.some((e: unknown) => typeof e === "string" && /already exists/i.test(e));
          if (alreadyExists) {
            const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email, password }),
            });
            const loginBody = await loginRes.json();
            if (!loginBody.ok) throw new Error(`register-then-login recovery failed for ${email}: ${JSON.stringify(loginBody)}`);
            return loginBody;
          }
          throw new Error(`register failed for ${email}: ${JSON.stringify(parsed)}`);
        });
        return { userId: body.data.user.id as number, token: body.data.token as string, email };
      }),
    );
    users.push(...results);
  }
  return users;
}

/** Chunk size for bulk `inArray` cleanup statements — one round-trip per chunk instead of
 * one per row, since this sandbox's dominant cost against a network-distant load-test
 * database is per-connection latency (see harness.ts's withRetry doc comment), not query
 * cost. Deletes the exact same rows a per-row loop would, just fewer round-trips. */
const CLEANUP_CHUNK = 500;

async function deleteInChunks<T>(ids: T[], deleteFn: (chunk: T[]) => Promise<unknown>) {
  for (let start = 0; start < ids.length; start += CLEANUP_CHUNK) {
    await withRetry(() => deleteFn(ids.slice(start, start + CLEANUP_CHUNK)));
  }
}

/** Full, verified cleanup for everything a load-test run created — same conventions as every other QA script this session. `db` defaults to the real application database, same as createLoadTestRound above. */
export async function cleanupLoadTestFixture(fixture: LoadTestRoundFixture, users: LoadTestUser[], db: AnyDb = getDb()) {
  const entries: (typeof schema.competitionEntries.$inferSelect)[] = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, fixture.competitionId));
  await deleteInChunks(
    entries.map((e) => e.id),
    (chunk) => db.delete(schema.entrySelections).where(inArray(schema.entrySelections.entryId, chunk)),
  );
  await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.competitionId, fixture.competitionId));
  const userIds = users.map((u) => u.userId);
  await deleteInChunks(userIds, (chunk) => db.delete(schema.paymentTransactions).where(inArray(schema.paymentTransactions.userId, chunk)));
  await deleteInChunks(userIds, (chunk) => db.delete(schema.walletTransactions).where(inArray(schema.walletTransactions.userId, chunk)));
  await deleteInChunks(userIds, (chunk) => db.delete(schema.wallets).where(inArray(schema.wallets.userId, chunk)));
  await db.delete(schema.competitions).where(eq(schema.competitions.id, fixture.competitionId));
  for (const g of fixture.games) {
    await db.delete(schema.gameLineups).where(eq(schema.gameLineups.gameId, g.id));
    await db.delete(schema.playerGameStats).where(eq(schema.playerGameStats.gameId, g.id));
    await db.delete(schema.games).where(eq(schema.games.id, g.id));
  }
  for (const g of fixture.games) await db.delete(schema.players).where(eq(schema.players.id, g.scorerId));
  for (const t of fixture.teamIds) await db.delete(schema.teams).where(eq(schema.teams.id, t));
  await db.delete(schema.rounds).where(eq(schema.rounds.id, fixture.roundId));
  await db.delete(schema.seasons).where(eq(schema.seasons.id, fixture.seasonId));
  await deleteInChunks(userIds, (chunk) => db.delete(schema.sessions).where(inArray(schema.sessions.userId, chunk)));
  await deleteInChunks(userIds, (chunk) => db.delete(schema.users).where(inArray(schema.users.id, chunk)));
}
