import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { canAcceptEntries, computeFirstGameKickoff } from "@/lib/competitions/lifecycle";
import { getSelectionConfig } from "@/lib/perfect2/registry";
import { isSelectionLocked, validateEntrySelections, validateSelection, type SelectionInput } from "@/lib/selections/validate";
import { getUserSelectionsForCompetition, type EntrySelectionInput } from "./entries";
import { getOrCreateCompetition } from "./competitions";
import { listGamesForRound, listLineupsForGames } from "./games";
import { getMaxEntriesPerRound } from "./platform-settings";
import { getRound } from "./rounds";
import { getSeasonById } from "./seasons";
import { debitWallet, linkWalletTransactionToEntries, refundToWallet } from "./wallet";
import { logEvent } from "@/lib/monitoring/log";
import { safeQuery, type DataResult } from "./result";

export type EntryPackage = typeof schema.entryPackages.$inferSelect;

/** Every purchasable package, cheapest-entry-count first — used to render the package-selection screen. Inactive packages are excluded; deactivating one only ever affects new purchases. */
export async function listActiveEntryPackages(): Promise<DataResult<EntryPackage[]>> {
  return safeQuery(async () => {
    const rows = await getDb().select().from(schema.entryPackages).where(eq(schema.entryPackages.active, true));
    return rows.sort((a, b) => a.displayOrder - b.displayOrder);
  });
}

export async function listAllEntryPackages(): Promise<DataResult<EntryPackage[]>> {
  return safeQuery(async () => {
    const rows = await getDb().select().from(schema.entryPackages);
    return rows.sort((a, b) => a.displayOrder - b.displayOrder);
  });
}

export interface CreateEntryPackageInput {
  entryCount: number;
  priceCents: number;
  label: string;
  badge?: string | null;
  displayOrder?: number;
}

/** Admin-only: adds a new purchasable package. Never affects any purchase already made — those keep their own recorded price/entry count forever. */
export async function createEntryPackage(input: CreateEntryPackageInput): Promise<DataResult<EntryPackage>> {
  return safeQuery(async () => {
    const [row] = await getDb()
      .insert(schema.entryPackages)
      .values({
        entryCount: input.entryCount,
        priceCents: input.priceCents,
        label: input.label,
        badge: input.badge ?? null,
        displayOrder: input.displayOrder ?? 0,
      })
      .returning();
    return row;
  });
}

export interface UpdateEntryPackageInput {
  entryCount?: number;
  priceCents?: number;
  label?: string;
  badge?: string | null;
  active?: boolean;
  displayOrder?: number;
}

/** Admin-only: edits or deactivates a package. Applies only to purchases made after this call — past purchases keep the price/entry count they actually paid, recorded permanently on their own wallet_transactions/competition_entries rows. */
export async function updateEntryPackage(id: number, patch: UpdateEntryPackageInput): Promise<DataResult<EntryPackage | null>> {
  return safeQuery(async () => {
    const [row] = await getDb()
      .update(schema.entryPackages)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.entryPackages.id, id))
      .returning();
    return row ?? null;
  });
}

/** Splits `totalCents` evenly across `count` entries without losing a single cent — the same base+remainder technique as allocatePrizePool (src/lib/perfect2/prize.ts), so e.g. a $35/10-entry package attributes exactly 350c to every entry, and a total that didn't divide evenly would still sum back to totalCents exactly. */
export function splitPackagePriceAcrossEntries(totalCents: number, count: number): number[] {
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

export interface PurchasePackageInput {
  sportId: number;
  sportCode: string;
  competitionName: string;
  roundId: number;
  userId: number;
  packageId: number;
  /**
   * ONE shared selection set — the customer picks the perfect round exactly once, and
   * every entry the package buys gets an identical copy of it. If the user already holds
   * at least one entry in this competition, this input is IGNORED entirely and their
   * existing selections are reused instead (see purchaseEntryPackage) — there is no
   * client-controlled path to a second, different selection set for the same
   * sport/round, by construction, not just by UI convention.
   */
  selections: EntrySelectionInput[];
  /**
   * A fresh key the client generates once per purchase attempt (e.g. when the review
   * screen mounts) and resends unchanged on any retry of that SAME attempt — never
   * regenerated for a genuinely new purchase decision. Required: makes a double-tap of
   * "Enter", a network-triggered client retry, or two concurrent identical requests
   * resolve to the exact same debit and the exact same set of entries, never a second
   * debit or a second batch of entries. See debitWallet's idempotencyKey opt.
   */
  idempotencyKey: string;
}

export type PurchasePackageResult =
  | { status: "ok"; entryIds: number[]; amountPaidCents: number; entryCount: number; newBalanceCents: number }
  | { status: "invalid"; errors: string[] }
  | { status: "insufficient_funds"; balanceCents: number; requiredCents: number }
  | { status: "unavailable"; message: string };

/**
 * The one place an entry-package purchase happens. Product model: the customer picks the
 * perfect round exactly ONCE; a package purchase buys N identical copies of that one
 * selection set, each as its own fully independent competition_entries +
 * entry_selections row-set (own entryId, own settlement, own PERFECT/NOT_PERFECT result —
 * never collapsed into one record). If the customer already holds an entry in this
 * competition, their existing stored selections are reused automatically (see
 * canonicalSelections below) — there is no way to create a second, different selection
 * set for the same sport/round.
 *
 * Sequence: validate package/round → check the round is open → check the
 * max-entries-per-round cap (counting real existing entries, not packages) → resolve the
 * canonical selection set (existing, or the fresh one supplied) → validate it once (only
 * if fresh) → atomically debit the wallet for the package's actual price (ONE ledger row,
 * never entryCount separate $5 charges) → create every entry → link the debit's
 * relatedEntryIds. If entry creation fails after the debit succeeded, the debit is
 * compensated with an equal refund credit (neon-http has no multi-statement transactions —
 * see src/db/schema.ts's wallets doc comment — so this is a compensating action, not a
 * rollback) and NO partial entries are left behind.
 */
export async function purchaseEntryPackage(input: PurchasePackageInput): Promise<PurchasePackageResult> {
  const db = getDb();

  const packageRows = await db.select().from(schema.entryPackages).where(and(eq(schema.entryPackages.id, input.packageId), eq(schema.entryPackages.active, true))).limit(1);
  const pkg = packageRows[0];
  if (!pkg) return { status: "invalid", errors: ["This entry package is not available."] };

  const roundResult = await getRound(input.roundId);
  if (roundResult.status === "unavailable") return { status: "unavailable", message: roundResult.message };
  if (!roundResult.data) return { status: "invalid", errors: ["This round doesn't exist."] };

  const seasonResult = await getSeasonById(roundResult.data.seasonId);
  if (seasonResult.status === "unavailable") return { status: "unavailable", message: seasonResult.message };
  if (!seasonResult.data || seasonResult.data.sportId !== input.sportId) {
    return { status: "invalid", errors: ["This round does not belong to the selected sport's competition."] };
  }

  const gamesResult = await listGamesForRound(input.roundId);
  if (gamesResult.status === "unavailable") return { status: "unavailable", message: gamesResult.message };
  const games = gamesResult.data;
  const roundGameIds = games.map((g) => g.id);

  const lineupsResult = await listLineupsForGames(roundGameIds);
  if (lineupsResult.status === "unavailable") return { status: "unavailable", message: lineupsResult.message };
  const eligibleByGame = new Map<number, Set<number>>();
  for (const lineup of lineupsResult.data) {
    if (!eligibleByGame.has(lineup.gameId)) eligibleByGame.set(lineup.gameId, new Set());
    eligibleByGame.get(lineup.gameId)!.add(lineup.playerId);
  }
  const gameById = new Map(games.map((g) => [g.id, g]));

  const firstGameKickoff = computeFirstGameKickoff(games);
  const competitionResult = await getOrCreateCompetition(input.sportId, input.roundId, input.competitionName, firstGameKickoff);
  if (competitionResult.status === "unavailable") return { status: "unavailable", message: competitionResult.message };
  const competition = competitionResult.data;

  if (!canAcceptEntries(competition)) {
    logEvent("cutoff_rejected", { userId: input.userId, competitionId: competition.id, sportCode: input.sportCode }, "warn");
    return { status: "invalid", errors: [`This ${input.competitionName} round is not currently open for entries.`] };
  }

  const [maxEntriesResult, existingEntries, existingSelectionsResult] = await Promise.all([
    getMaxEntriesPerRound(),
    db.select().from(schema.competitionEntries).where(and(eq(schema.competitionEntries.competitionId, competition.id), eq(schema.competitionEntries.userId, input.userId))),
    getUserSelectionsForCompetition(input.userId, competition.id),
  ]);
  if (maxEntriesResult.status === "unavailable") return { status: "unavailable", message: maxEntriesResult.message };
  const maxEntries = maxEntriesResult.data;
  if (existingSelectionsResult.status === "unavailable") return existingSelectionsResult;

  if (existingEntries.length + pkg.entryCount > maxEntries) {
    logEvent("max_entry_cap_rejected", { userId: input.userId, competitionId: competition.id, existing: existingEntries.length, requested: pkg.entryCount, maxEntries }, "warn");
    return { status: "invalid", errors: [`You can have a maximum of ${maxEntries} entries in this round.`] };
  }

  // ONE shared selection set, enforced server-side: if the customer already holds an
  // entry in this competition, their EXISTING stored selections are used for every
  // additional entry this purchase creates — the client's own `input.selections` is
  // ignored entirely in that case. This is the actual guarantee behind "one set of picks
  // per customer per round" — not a UI convention the client could bypass, but a real
  // server-side substitution that makes a second, different selection set impossible to
  // create no matter what a (buggy or malicious) client submits.
  const canonicalSelections: EntrySelectionInput[] = existingSelectionsResult.data ?? input.selections;

  const selectionsPerGame = getSelectionConfig(input.sportCode).selectionsPerGame;
  // Only validate a FRESH selection set (first purchase in this competition) — an
  // already-open competition (canAcceptEntries above) can't have any game locked yet
  // (closesAt is always the first game's kickoff), so re-validating stored, already-once-
  // validated selections on every subsequent purchase would be redundant, not safer.
  if (!existingSelectionsResult.data) {
    const errors: string[] = [];
    const selectionInputs: SelectionInput[] = canonicalSelections.map((s) => ({ gameId: s.gameId, playerIds: s.playerIds }));
    const roundValidation = validateEntrySelections(roundGameIds, selectionInputs);
    if (!roundValidation.valid) {
      errors.push(...roundValidation.errors);
    } else {
      for (const selection of canonicalSelections) {
        const game = gameById.get(selection.gameId);
        if (game && isSelectionLocked({ status: game.status, kickoff: game.kickoff })) {
          errors.push(`Selections are locked for the ${game.homeTeam?.name ?? ""} vs ${game.awayTeam?.name ?? ""} game — it has already started.`);
          continue;
        }
        const eligible = eligibleByGame.get(selection.gameId) ?? new Set<number>();
        const result = validateSelection({ gameId: selection.gameId, playerIds: selection.playerIds }, eligible, selectionsPerGame);
        if (!result.valid) errors.push(...result.errors);
      }
    }
    if (errors.length > 0) return { status: "invalid", errors };
  }

  const debitResult = await debitWallet(input.userId, pkg.priceCents, "entry_purchase", `Perfect Play — ${pkg.label} Package`, {
    relatedCompetitionId: competition.id,
    idempotencyKey: input.idempotencyKey,
  });
  if (debitResult.status === "unavailable") return debitResult;
  if (debitResult.status === "insufficient_funds") return debitResult;
  const { transaction, newBalanceCents } = debitResult;

  // A retried request (same idempotencyKey) — the debit already happened and the entries
  // already exist from the original attempt. Never debit or create again: return the
  // original outcome, read back from the transaction's own relatedEntryIds.
  if (debitResult.alreadyExisted) {
    const existingEntryIds = transaction.relatedEntryIds ?? [];
    logEvent("package_purchase_idempotent_replay", { userId: input.userId, competitionId: competition.id, packageId: pkg.id, idempotencyKey: input.idempotencyKey });
    return { status: "ok", entryIds: existingEntryIds, amountPaidCents: transaction.amountCents * -1, entryCount: existingEntryIds.length, newBalanceCents };
  }

  const perEntryAmounts = splitPackagePriceAcrossEntries(pkg.priceCents, pkg.entryCount);
  const createdEntryIds: number[] = [];

  try {
    for (let i = 0; i < pkg.entryCount; i++) {
      const [entry] = await db
        .insert(schema.competitionEntries)
        .values({ competitionId: competition.id, userId: input.userId, paymentStatus: "paid", paidAmountCents: perEntryAmounts[i] })
        .returning();
      createdEntryIds.push(entry.id);
      // Every entry gets an independent COPY of the exact same canonical selections —
      // never a shared row, never a reference — so each remains fully independently
      // queryable/settleable (see settle.ts, which already only ever reads by entryId),
      // while still being provably identical in content.
      await db.insert(schema.entrySelections).values(
        canonicalSelections.map((s) => ({
          entryId: entry.id,
          gameId: s.gameId,
          selectedPlayer1Id: s.playerIds[0],
          selectedPlayer2Id: s.playerIds[1] ?? null,
        })),
      );
    }

    // Race-safety: the maxEntries check above reads existingEntries.length BEFORE this
    // purchase's own inserts commit, so two concurrent package purchases for the same
    // user+round can both pass it and together push the real total past maxEntries — a
    // classic TOCTOU gap, the same class of bug fixed for single-entry createEntry (see
    // entries.ts). Re-count for real, post-insert, and compensate (refund + delete) if
    // this specific purchase is the one that pushed the total over the cap. This can very
    // rarely over-reject under a genuine simultaneous three-way-or-more race (each request
    // sees a total that includes purchases still mid-rollback), but it can never leave the
    // user with more entries than maxEntries — a safe failure mode, not a silent breach.
    const finalCount = await db
      .select()
      .from(schema.competitionEntries)
      .where(and(eq(schema.competitionEntries.competitionId, competition.id), eq(schema.competitionEntries.userId, input.userId)));
    if (finalCount.length > maxEntries) {
      for (const entryId of createdEntryIds) {
        await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, entryId));
        await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId));
      }
      await refundToWallet(input.userId, pkg.priceCents, competition.id, [], "Entry package purchase exceeded the round's entry cap — refunded");
      logEvent("max_entry_cap_rejected", { userId: input.userId, competitionId: competition.id, packageId: pkg.id, reason: "post_insert_race" }, "warn");
      return { status: "invalid", errors: [`You can have a maximum of ${maxEntries} entries in this round.`] };
    }

    await linkWalletTransactionToEntries(transaction.id, createdEntryIds);

    logEvent("package_purchase_succeeded", {
      userId: input.userId,
      competitionId: competition.id,
      packageId: pkg.id,
      entryCount: pkg.entryCount,
      amountPaidCents: pkg.priceCents,
    });
    return { status: "ok", entryIds: createdEntryIds, amountPaidCents: pkg.priceCents, entryCount: pkg.entryCount, newBalanceCents };
  } catch (error) {
    // Compensating refund — no native rollback available (neon-http has no multi-statement
    // transactions). Any entries that did insert before the failure are deleted (cascading
    // to their selections) so no partial package is ever left in place, and the wallet is
    // made whole with an equal refund credit.
    for (const entryId of createdEntryIds) {
      await db.delete(schema.entrySelections).where(eq(schema.entrySelections.entryId, entryId));
      await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId));
    }
    await refundToWallet(input.userId, pkg.priceCents, competition.id, [], "Entry package purchase failed — refunded");
    logEvent(
      "package_purchase_failed",
      { userId: input.userId, competitionId: competition.id, packageId: pkg.id, message: error instanceof Error ? error.message : String(error) },
      "error",
    );
    return { status: "unavailable", message: error instanceof Error ? error.message : "Unknown error creating entries." };
  }
}
