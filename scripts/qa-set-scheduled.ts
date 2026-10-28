/**
 * QA correction: entries can only be created for games that haven't started yet
 * (isSelectionLocked correctly rejected the initial seed, which had g1/g2/h1/h2 already
 * "final" — that's the entry-locking system working as designed). Reset those games to
 * "scheduled" with a future kickoff and no score/stats, so entries can be submitted
 * first; qa-finalize-games.ts then simulates them finishing, exactly like a real
 * pre-kickoff → post-match sync would.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { inArray } from "drizzle-orm";
import { readFileSync } from "node:fs";
import * as schema from "../src/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });
const ids = JSON.parse(readFileSync(new URL("./_qa-ids.json", import.meta.url), "utf8"));

async function main() {
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const gameIds = [ids.games.g1, ids.games.g2, ids.games.h1, ids.games.h2];

  await db
    .update(schema.games)
    .set({ status: "scheduled", kickoff: future, homeScore: null, awayScore: null })
    .where(inArray(schema.games.id, gameIds));

  await db.delete(schema.playerGameStats).where(inArray(schema.playerGameStats.gameId, gameIds));

  console.log("Reset games to scheduled (future kickoff, no stats):", gameIds);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
