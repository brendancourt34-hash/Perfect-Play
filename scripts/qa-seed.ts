/**
 * PHASE 13 INTERNAL QA — TEMPORARY TEST DATA SEED.
 *
 * Every row this script creates is prefixed "QA TEST" / "qa-" so it can never be mistaken
 * for real provider data, and is fully removed by scripts/qa-cleanup.ts at the end of the
 * QA run. This script is NOT part of the application — it is a one-off QA fixture, run
 * manually via `npx dotenv -e .env.local -- npx tsx scripts/qa-seed.ts`.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { writeFileSync } from "node:fs";
import * as schema from "../src/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

async function main() {
  const [nrlSport] = await db.insert(schema.sports).values({ code: "nrl", name: "QA TEST — National Rugby League" }).returning();
  const [aflSport] = await db.insert(schema.sports).values({ code: "afl", name: "QA TEST — Australian Football League" }).returning();

  const [nrlSeason] = await db
    .insert(schema.seasons)
    .values({ sportId: nrlSport.id, year: 2026, label: "QA TEST SEASON — DELETE ME", isCurrent: true, externalId: "qa-nrl-season-1" })
    .returning();
  const [aflSeason] = await db
    .insert(schema.seasons)
    .values({ sportId: aflSport.id, year: 2026, label: "QA TEST SEASON — DELETE ME", isCurrent: true, externalId: "qa-afl-season-1" })
    .returning();

  const nrlTeamNames = ["Alpha", "Bravo", "Charlie", "Delta"];
  const nrlTeams: (typeof schema.teams.$inferSelect)[] = [];
  for (const name of nrlTeamNames) {
    const [team] = await db
      .insert(schema.teams)
      .values({
        sportId: nrlSport.id,
        name: `QA Test Team ${name}`,
        shortName: `QA${name[0]}`,
        slug: `qa-test-team-${name.toLowerCase()}-nrl`,
        externalId: `qa-team-nrl-${name.toLowerCase()}`,
      })
      .returning();
    nrlTeams.push(team);
  }
  const [alpha, bravo, charlie, delta] = nrlTeams;

  const aflTeamNames = ["Echo", "Foxtrot", "Golf", "Hotel"];
  const aflTeams: (typeof schema.teams.$inferSelect)[] = [];
  for (const name of aflTeamNames) {
    const [team] = await db
      .insert(schema.teams)
      .values({
        sportId: aflSport.id,
        name: `QA Test Team ${name}`,
        shortName: `QA${name[0]}`,
        slug: `qa-test-team-${name.toLowerCase()}-afl`,
        externalId: `qa-team-afl-${name.toLowerCase()}`,
      })
      .returning();
    aflTeams.push(team);
  }
  const [echo, foxtrot, golf, hotel] = aflTeams;

  const [nrlRound] = await db
    .insert(schema.rounds)
    .values({
      seasonId: nrlSeason.id,
      roundNumber: 1,
      name: "QA TEST ROUND 1 — DELETE ME",
      status: "in_progress",
      externalId: "qa-nrl-round-1",
    })
    .returning();
  const [aflRound] = await db
    .insert(schema.rounds)
    .values({
      seasonId: aflSeason.id,
      roundNumber: 1,
      name: "QA TEST ROUND 1 — DELETE ME",
      status: "in_progress",
      externalId: "qa-afl-round-1",
    })
    .returning();

  const now = new Date();
  const past = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const future = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  const [g1] = await db
    .insert(schema.games)
    .values({ roundId: nrlRound.id, homeTeamId: alpha.id, awayTeamId: bravo.id, kickoff: past, venue: "QA Test Stadium", status: "final", homeScore: 20, awayScore: 18, externalId: "qa-nrl-game-1" })
    .returning();
  const [g2] = await db
    .insert(schema.games)
    .values({ roundId: nrlRound.id, homeTeamId: charlie.id, awayTeamId: delta.id, kickoff: past, venue: "QA Test Stadium", status: "final", homeScore: 24, awayScore: 6, externalId: "qa-nrl-game-2" })
    .returning();
  const [g3] = await db
    .insert(schema.games)
    .values({ roundId: nrlRound.id, homeTeamId: alpha.id, awayTeamId: charlie.id, kickoff: future, venue: "QA Test Stadium", status: "scheduled", externalId: "qa-nrl-game-3" })
    .returning();

  const [h1] = await db
    .insert(schema.games)
    .values({ roundId: aflRound.id, homeTeamId: echo.id, awayTeamId: foxtrot.id, kickoff: past, venue: "QA Test Oval", status: "final", homeScore: 88, awayScore: 74, externalId: "qa-afl-game-1" })
    .returning();
  const [h2] = await db
    .insert(schema.games)
    .values({ roundId: aflRound.id, homeTeamId: golf.id, awayTeamId: hotel.id, kickoff: past, venue: "QA Test Oval", status: "final", homeScore: 90, awayScore: 60, externalId: "qa-afl-game-2" })
    .returning();

  async function makePlayer(sportId: number, teamId: number, label: string, position: string, externalId: string) {
    const [player] = await db
      .insert(schema.players)
      .values({ sportId, teamId, firstName: "QA", lastName: label, position, externalId })
      .returning();
    return player;
  }

  const a1 = await makePlayer(nrlSport.id, alpha.id, "Scorer Alpha1", "Fullback", "qa-player-nrl-a1");
  const a2 = await makePlayer(nrlSport.id, alpha.id, "NonScorer Alpha2", "Prop", "qa-player-nrl-a2");
  const b1 = await makePlayer(nrlSport.id, bravo.id, "Scorer Bravo1", "Halfback", "qa-player-nrl-b1");
  const b2 = await makePlayer(nrlSport.id, bravo.id, "NonScorer Bravo2", "Winger", "qa-player-nrl-b2");
  const c1 = await makePlayer(nrlSport.id, charlie.id, "Scorer Charlie1", "Hooker", "qa-player-nrl-c1");
  const c2 = await makePlayer(nrlSport.id, charlie.id, "Scorer Charlie2", "Centre", "qa-player-nrl-c2");
  const d1 = await makePlayer(nrlSport.id, delta.id, "NonScorer Delta1", "Five-Eighth", "qa-player-nrl-d1");
  const d2 = await makePlayer(nrlSport.id, delta.id, "NonScorer Delta2", "Lock", "qa-player-nrl-d2");

  const e1 = await makePlayer(aflSport.id, echo.id, "Scorer Echo1", "Full Forward", "qa-player-afl-e1");
  const e2 = await makePlayer(aflSport.id, echo.id, "NonScorer Echo2", "Ruck", "qa-player-afl-e2");
  const f1 = await makePlayer(aflSport.id, foxtrot.id, "Scorer Foxtrot1", "Midfielder", "qa-player-afl-f1");
  const f2 = await makePlayer(aflSport.id, foxtrot.id, "NonScorer Foxtrot2", "Defender", "qa-player-afl-f2");
  const gg1 = await makePlayer(aflSport.id, golf.id, "Scorer Golf1", "Half Forward", "qa-player-afl-g1");
  const gg2 = await makePlayer(aflSport.id, golf.id, "Scorer Golf2", "Wing", "qa-player-afl-g2");
  const hh1 = await makePlayer(aflSport.id, hotel.id, "NonScorer Hotel1", "Full Back", "qa-player-afl-h1");
  const hh2 = await makePlayer(aflSport.id, hotel.id, "NonScorer Hotel2", "Centre", "qa-player-afl-h2");

  async function lineup(gameId: number, teamId: number, player: typeof a1) {
    await db.insert(schema.gameLineups).values({ gameId, teamId, playerId: player.id, position: player.position!, isStarting: true });
  }
  await lineup(g1.id, alpha.id, a1);
  await lineup(g1.id, alpha.id, a2);
  await lineup(g1.id, bravo.id, b1);
  await lineup(g1.id, bravo.id, b2);
  await lineup(g2.id, charlie.id, c1);
  await lineup(g2.id, charlie.id, c2);
  await lineup(g2.id, delta.id, d1);
  await lineup(g2.id, delta.id, d2);
  await lineup(g3.id, alpha.id, a1);
  await lineup(g3.id, alpha.id, a2);
  await lineup(g3.id, charlie.id, c1);
  await lineup(g3.id, charlie.id, c2);

  await lineup(h1.id, echo.id, e1);
  await lineup(h1.id, echo.id, e2);
  await lineup(h1.id, foxtrot.id, f1);
  await lineup(h1.id, foxtrot.id, f2);
  await lineup(h2.id, golf.id, gg1);
  await lineup(h2.id, golf.id, gg2);
  await lineup(h2.id, hotel.id, hh1);
  await lineup(h2.id, hotel.id, hh2);

  async function stat(gameId: number, player: typeof a1, teamId: number, field: "tries" | "goals", count: number) {
    await db.insert(schema.playerGameStats).values({ gameId, playerId: player.id, teamId, tries: field === "tries" ? count : 0, goals: field === "goals" ? count : 0 });
  }
  await stat(g1.id, a1, alpha.id, "tries", 2);
  await stat(g1.id, a2, alpha.id, "tries", 0);
  await stat(g1.id, b1, bravo.id, "tries", 1);
  await stat(g1.id, b2, bravo.id, "tries", 0);
  await stat(g2.id, c1, charlie.id, "tries", 1);
  await stat(g2.id, c2, charlie.id, "tries", 3);
  await stat(g2.id, d1, delta.id, "tries", 0);
  await stat(g2.id, d2, delta.id, "tries", 0);
  // g3 deliberately has NO stats yet (status "scheduled") — used to test PENDING.

  await stat(h1.id, e1, echo.id, "goals", 1);
  await stat(h1.id, e2, echo.id, "goals", 0);
  await stat(h1.id, f1, foxtrot.id, "goals", 2);
  await stat(h1.id, f2, foxtrot.id, "goals", 0);
  await stat(h2.id, gg1, golf.id, "goals", 1);
  await stat(h2.id, gg2, golf.id, "goals", 1);
  await stat(h2.id, hh1, hotel.id, "goals", 0);
  await stat(h2.id, hh2, hotel.id, "goals", 0);

  const ids = {
    sports: { nrl: nrlSport.id, afl: aflSport.id },
    seasons: { nrl: nrlSeason.id, afl: aflSeason.id },
    rounds: { nrl: nrlRound.id, afl: aflRound.id },
    teams: { alpha: alpha.id, bravo: bravo.id, charlie: charlie.id, delta: delta.id, echo: echo.id, foxtrot: foxtrot.id, golf: golf.id, hotel: hotel.id },
    games: { g1: g1.id, g2: g2.id, g3: g3.id, h1: h1.id, h2: h2.id },
    players: {
      a1: a1.id, a2: a2.id, b1: b1.id, b2: b2.id, c1: c1.id, c2: c2.id, d1: d1.id, d2: d2.id,
      e1: e1.id, e2: e2.id, f1: f1.id, f2: f2.id, gg1: gg1.id, gg2: gg2.id, hh1: hh1.id, hh2: hh2.id,
    },
  };
  writeFileSync(new URL("./_qa-ids.json", import.meta.url), JSON.stringify(ids, null, 2));
  console.log("QA seed complete. IDs written to scripts/_qa-ids.json");
  console.log(JSON.stringify(ids, null, 2));
}

main().catch((err) => {
  console.error("QA seed failed:", err);
  process.exit(1);
});
