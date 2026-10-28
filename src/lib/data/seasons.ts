import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { safeQuery, type DataResult } from "./result";

export type Season = typeof schema.seasons.$inferSelect;

export async function listSeasons(sportId: number): Promise<DataResult<Season[]>> {
  return safeQuery(() =>
    getDb().select().from(schema.seasons).where(eq(schema.seasons.sportId, sportId)).orderBy(desc(schema.seasons.year)),
  );
}

export async function getCurrentSeason(sportId: number): Promise<DataResult<Season | null>> {
  return safeQuery(async () => {
    const rows = await getDb()
      .select()
      .from(schema.seasons)
      .where(and(eq(schema.seasons.sportId, sportId), eq(schema.seasons.isCurrent, true)))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function getSeasonById(seasonId: number): Promise<DataResult<Season | null>> {
  return safeQuery(async () => {
    const rows = await getDb().select().from(schema.seasons).where(eq(schema.seasons.id, seasonId)).limit(1);
    return rows[0] ?? null;
  });
}
