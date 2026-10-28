/**
 * QA helper: marks one game "final" and writes its player stats — simulating a real
 * match completing and results syncing in. Usage:
 *   npx tsx scripts/qa-finalize-game.ts <gameId> <homeScore> <awayScore> <statField> <playerId:count> [<playerId:count> ...]
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

async function main() {
  const [gameIdArg, homeScoreArg, awayScoreArg, statField, ...statArgs] = process.argv.slice(2);
  const gameId = Number(gameIdArg);

  await db
    .update(schema.games)
    .set({ status: "final", homeScore: Number(homeScoreArg), awayScore: Number(awayScoreArg) })
    .where(eq(schema.games.id, gameId));

  const gameRows = await db.select().from(schema.games).where(eq(schema.games.id, gameId)).limit(1);
  const game = gameRows[0];

  for (const arg of statArgs) {
    const [playerIdStr, countStr] = arg.split(":");
    const playerId = Number(playerIdStr);
    const count = Number(countStr);
    const playerRows = await db.select().from(schema.players).where(eq(schema.players.id, playerId)).limit(1);
    const teamId = playerRows[0].teamId!;
    await db.insert(schema.playerGameStats).values({
      gameId,
      playerId,
      teamId,
      tries: statField === "tries" ? count : 0,
      goals: statField === "goals" ? count : 0,
    });
  }

  console.log(`Game ${gameId} finalized (${game.homeScore}-${game.awayScore}), ${statArgs.length} stat rows written.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
