import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { safeQuery, type DataResult } from "./result";

export type Sport = typeof schema.sports.$inferSelect;

export async function listSports(): Promise<DataResult<Sport[]>> {
  return safeQuery(() => getDb().select().from(schema.sports).orderBy(schema.sports.name));
}

export async function getSportByCode(code: string): Promise<DataResult<Sport | null>> {
  return safeQuery(async () => {
    const rows = await getDb().select().from(schema.sports).where(eq(schema.sports.code, code)).limit(1);
    return rows[0] ?? null;
  });
}

/** Creates the sport row on first use (e.g. NBA's first schedule sync) — a no-op if it already exists. */
export async function getOrCreateSport(code: string, name: string): Promise<DataResult<Sport>> {
  return safeQuery(async () => {
    const db = getDb();
    const existing = await db.select().from(schema.sports).where(eq(schema.sports.code, code)).limit(1);
    if (existing[0]) return existing[0];
    const inserted = await db.insert(schema.sports).values({ code, name }).returning();
    return inserted[0];
  });
}
