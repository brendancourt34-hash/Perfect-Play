import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { safeQuery, type DataResult } from "./result";

export type Round = typeof schema.rounds.$inferSelect;

/**
 * Every real, customer-facing round for a season — never includes a sport's internal
 * "schedule pool" staging round (rounds.isSchedulePool, see src/lib/data/schedule-pool.ts),
 * which exists purely for admin curation and must never be shown to a customer as if it
 * were an actual round.
 */
export async function listRounds(seasonId: number): Promise<DataResult<Round[]>> {
  return safeQuery(() =>
    getDb()
      .select()
      .from(schema.rounds)
      .where(and(eq(schema.rounds.seasonId, seasonId), eq(schema.rounds.isSchedulePool, false)))
      .orderBy(asc(schema.rounds.roundNumber)),
  );
}

export async function getRound(roundId: number): Promise<DataResult<Round | null>> {
  return safeQuery(async () => {
    const rows = await getDb().select().from(schema.rounds).where(eq(schema.rounds.id, roundId)).limit(1);
    return rows[0] ?? null;
  });
}
