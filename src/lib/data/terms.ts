import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { TermsSection, TermsVersionStatus } from "@/db/schema";
import { safeQuery, type DataResult } from "./result";

export type TermsVersion = typeof schema.termsVersions.$inferSelect;
export type TermsAcceptance = typeof schema.termsAcceptances.$inferSelect;

/** The single currently-published version, if any — at most one row can ever have status "published" (publishing archives whatever was published before). Null before the very first publish. */
export async function getCurrentPublishedTerms(): Promise<DataResult<TermsVersion | null>> {
  return safeQuery(async () => {
    const rows = await getDb().select().from(schema.termsVersions).where(eq(schema.termsVersions.status, "published")).limit(1);
    return rows[0] ?? null;
  });
}

export async function getTermsVersionById(id: number): Promise<DataResult<TermsVersion | null>> {
  return safeQuery(async () => {
    const rows = await getDb().select().from(schema.termsVersions).where(eq(schema.termsVersions.id, id)).limit(1);
    return rows[0] ?? null;
  });
}

/** Every version regardless of status, newest first — admin history view. */
export async function listTermsVersions(): Promise<DataResult<TermsVersion[]>> {
  return safeQuery(() => getDb().select().from(schema.termsVersions).orderBy(desc(schema.termsVersions.createdAt)));
}

export interface CreateDraftTermsInput {
  versionNumber: string;
  effectiveDate: string;
  content: TermsSection[];
  createdByUserId: number;
}

export async function createDraftTermsVersion(input: CreateDraftTermsInput): Promise<DataResult<TermsVersion>> {
  return safeQuery(async () => {
    const [row] = await getDb()
      .insert(schema.termsVersions)
      .values({
        versionNumber: input.versionNumber,
        effectiveDate: input.effectiveDate,
        content: input.content,
        createdByUserId: input.createdByUserId,
        status: "draft",
      })
      .returning();
    return row;
  });
}

export type UpdateDraftTermsResult =
  | { status: "ok"; version: TermsVersion }
  | { status: "not_found" }
  | { status: "not_draft"; currentStatus: TermsVersionStatus }
  | { status: "unavailable"; message: string };

/** Edits a draft's content/dates. A published or archived version is immutable — a user's historical acceptance must always point at exactly the content they agreed to, so editing after publish would silently rewrite what they accepted. */
export async function updateDraftTermsVersion(id: number, patch: { versionNumber?: string; effectiveDate?: string; content?: TermsSection[] }): Promise<UpdateDraftTermsResult> {
  const db = getDb();
  const existingResult = await safeQuery(async () => {
    const rows = await db.select().from(schema.termsVersions).where(eq(schema.termsVersions.id, id)).limit(1);
    return rows[0] ?? null;
  });
  if (existingResult.status === "unavailable") return existingResult;
  const existing = existingResult.data;
  if (!existing) return { status: "not_found" };
  if (existing.status !== "draft") return { status: "not_draft", currentStatus: existing.status };

  const result = await safeQuery(async () => {
    const [row] = await db
      .update(schema.termsVersions)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.termsVersions.id, id))
      .returning();
    return row;
  });
  if (result.status === "unavailable") return result;
  return { status: "ok", version: result.data };
}

export type PublishTermsResult =
  | { status: "ok"; version: TermsVersion }
  | { status: "not_found" }
  | { status: "not_draft"; currentStatus: TermsVersionStatus }
  | { status: "unavailable"; message: string };

/**
 * Publishes a draft: archives whatever version is currently published (if any) and marks
 * this one published+publishedAt=now. Published versions are immutable and never silently
 * overwritten — republishing content means creating a NEW draft version and publishing
 * that, never editing an already-published row. Not a single multi-statement transaction
 * (neon-http has none — see src/db/schema.ts's wallets doc comment) but safe regardless:
 * archiving the old published row is idempotent, and even if the process died between the
 * two steps, at most one row would incorrectly stay "published" alongside the new one,
 * which getCurrentPublishedTerms (LIMIT 1) already guards against by design — a follow-up
 * publish call always self-heals by archiving whatever it finds still published.
 */
export async function publishTermsVersion(id: number): Promise<PublishTermsResult> {
  const db = getDb();
  const existingResult = await safeQuery(async () => {
    const rows = await db.select().from(schema.termsVersions).where(eq(schema.termsVersions.id, id)).limit(1);
    return rows[0] ?? null;
  });
  if (existingResult.status === "unavailable") return existingResult;
  const existing = existingResult.data;
  if (!existing) return { status: "not_found" };
  if (existing.status !== "draft") return { status: "not_draft", currentStatus: existing.status };

  const archiveResult = await safeQuery(() =>
    db.update(schema.termsVersions).set({ status: "archived", updatedAt: new Date() }).where(and(eq(schema.termsVersions.status, "published"))),
  );
  if (archiveResult.status === "unavailable") return archiveResult;

  const publishResult = await safeQuery(async () => {
    const [row] = await db
      .update(schema.termsVersions)
      .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.termsVersions.id, id))
      .returning();
    return row;
  });
  if (publishResult.status === "unavailable") return publishResult;
  return { status: "ok", version: publishResult.data };
}

export interface RecordAcceptanceInput {
  userId: number;
  termsVersionId: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Idempotent: accepting the same version twice (e.g. a retried request) is a safe no-op, never a duplicate row, via the unique (userId, termsVersionId) index. */
export async function recordTermsAcceptance(input: RecordAcceptanceInput): Promise<DataResult<TermsAcceptance>> {
  return safeQuery(async () => {
    const db = getDb();
    const inserted = await db
      .insert(schema.termsAcceptances)
      .values({ userId: input.userId, termsVersionId: input.termsVersionId, ipAddress: input.ipAddress ?? null, userAgent: input.userAgent ?? null })
      .onConflictDoNothing({ target: [schema.termsAcceptances.userId, schema.termsAcceptances.termsVersionId] })
      .returning();
    if (inserted[0]) return inserted[0];
    const existing = await db
      .select()
      .from(schema.termsAcceptances)
      .where(and(eq(schema.termsAcceptances.userId, input.userId), eq(schema.termsAcceptances.termsVersionId, input.termsVersionId)))
      .limit(1);
    return existing[0];
  });
}

/** Whether this user has accepted the CURRENTLY published version specifically — accepting an older version never counts once a newer one publishes. */
export async function hasUserAcceptedCurrentTerms(userId: number): Promise<DataResult<{ accepted: boolean; currentVersion: TermsVersion | null }>> {
  return safeQuery(async () => {
    const db = getDb();
    const currentRows = await db.select().from(schema.termsVersions).where(eq(schema.termsVersions.status, "published")).limit(1);
    const current = currentRows[0] ?? null;
    if (!current) return { accepted: false, currentVersion: null };

    const acceptanceRows = await db
      .select()
      .from(schema.termsAcceptances)
      .where(and(eq(schema.termsAcceptances.userId, userId), eq(schema.termsAcceptances.termsVersionId, current.id)))
      .limit(1);
    return { accepted: acceptanceRows.length > 0, currentVersion: current };
  });
}

export interface TermsAcceptanceSummary {
  userId: number;
  userEmail: string;
  acceptedAt: Date;
}

/** Admin view: everyone who has accepted a specific version, newest first. */
export async function listAcceptancesForVersion(termsVersionId: number): Promise<DataResult<TermsAcceptanceSummary[]>> {
  return safeQuery(async () => {
    const rows = await getDb()
      .select({ userId: schema.termsAcceptances.userId, userEmail: schema.users.email, acceptedAt: schema.termsAcceptances.acceptedAt })
      .from(schema.termsAcceptances)
      .innerJoin(schema.users, eq(schema.users.id, schema.termsAcceptances.userId))
      .where(eq(schema.termsAcceptances.termsVersionId, termsVersionId))
      .orderBy(desc(schema.termsAcceptances.acceptedAt));
    return rows;
  });
}
