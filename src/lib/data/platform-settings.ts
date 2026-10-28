import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { safeQuery, type DataResult } from "./result";

const MAX_ENTRIES_PER_ROUND_KEY = "max_entries_per_round";
const DEFAULT_MAX_ENTRIES_PER_ROUND = 10;

const PRIZE_POOL_ALLOCATION_BPS_KEY = "prize_pool_allocation_bps";
/** 6000 basis points = 60.00% — the initial Phase 23E demonstration/configuration value. This is a modeling default only; it does not represent a final commercial or regulatory agreement with any wagering partner. See docs/phase23e-commercial-economics.md. */
export const DEFAULT_PRIZE_POOL_ALLOCATION_BPS = 6000;

export type PlatformSetting = typeof schema.platformSettings.$inferSelect;

/** Admin-configurable cap on entries a single user can hold in one round, applied independently per sport (a round only ever belongs to one sport's competition). Falls back to the documented default if never explicitly set. */
export async function getMaxEntriesPerRound(): Promise<DataResult<number>> {
  return safeQuery(async () => {
    const rows = await getDb().select().from(schema.platformSettings).where(eq(schema.platformSettings.key, MAX_ENTRIES_PER_ROUND_KEY)).limit(1);
    const value = rows[0]?.value;
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_ENTRIES_PER_ROUND;
  });
}

/**
 * Global default prize-pool allocation percentage, expressed as basis points (6000 = 60%)
 * for deterministic integer-safe money math — never a float. Falls back to
 * DEFAULT_PRIZE_POOL_ALLOCATION_BPS if never explicitly set. A specific competition may
 * override this via competitions.prizePoolAllocationBps (see resolvePrizePoolAllocationBps,
 * src/lib/perfect2/commercial.ts) — this function only ever returns the GLOBAL default.
 */
export async function getPrizePoolAllocationBps(): Promise<DataResult<number>> {
  return safeQuery(async () => {
    const rows = await getDb().select().from(schema.platformSettings).where(eq(schema.platformSettings.key, PRIZE_POOL_ALLOCATION_BPS_KEY)).limit(1);
    const value = rows[0]?.value;
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10000 ? value : DEFAULT_PRIZE_POOL_ALLOCATION_BPS;
  });
}

/** Admin write path — upserts a setting by key. Applies only to reads that happen after this call; never retroactively rewrites past purchases, which store their own actual values. */
export async function setPlatformSetting(key: string, value: unknown): Promise<DataResult<{ setting: PlatformSetting; previousValue: unknown }>> {
  return safeQuery(async () => {
    const db = getDb();
    const before = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.key, key)).limit(1);
    const [row] = await db
      .insert(schema.platformSettings)
      .values({ key, value: value as never, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.platformSettings.key, set: { value: value as never, updatedAt: new Date() } })
      .returning();
    return { setting: row, previousValue: before[0]?.value ?? null };
  });
}

export async function listPlatformSettings(): Promise<DataResult<PlatformSetting[]>> {
  return safeQuery(() => getDb().select().from(schema.platformSettings));
}
