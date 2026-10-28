import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { GameStatus } from "@/db/schema";
import { canAcceptEntries, computeFirstGameKickoff } from "@/lib/competitions/lifecycle";
import { getSelectionConfig } from "@/lib/perfect2/registry";
import { settleEntrySelections } from "@/lib/perfect2/settle";
import type { EntryResult, GameSelectionResult, SelectionResult } from "@/lib/perfect2/types";
import { isSelectionLocked, validateEntrySelections, validateSelection, type SelectionInput } from "@/lib/selections/validate";
import { chargeForEntry } from "./payment-transactions";
import { getOrCreateCompetition } from "./competitions";
import { listGamesForRound, listLineupsForGames } from "./games";
import { getRound } from "./rounds";
import { getSeasonById } from "./seasons";
import { logEvent } from "@/lib/monitoring/log";
import { safeQuery, type DataResult } from "./result";

export interface EntrySelectionInput {
  gameId: number;
  /** One player id per required selection for this sport — length 1 for every sport since Phase 23F. */
  playerIds: number[];
}

export interface CreateEntryInput {
  sportId: number;
  sportCode: string;
  competitionName: string;
  roundId: number;
  userEmail: string;
  userName: string;
  selections: EntrySelectionInput[];
}

export type CreateEntryResult =
  | { status: "ok"; entryId: number }
  | { status: "invalid"; errors: string[] }
  | { status: "unavailable"; message: string };

/**
 * Creates a competition entry: validates every selection against the round's real
 * lineup data (no position/eligibility rule beyond "is this player in this game"),
 * rejects the whole entry if any of the round's games has already locked, charges the
 * competition's configured entryFeeCents through the payment abstraction (src/lib/payments
 * — currently always the dev/test placeholder, which never reports "paid"), then writes
 * the entry (with whatever payment status the provider returned) and its per-game
 * selections. A failed/cancelled charge means no entry row is created at all.
 */
export async function createEntry(input: CreateEntryInput): Promise<CreateEntryResult> {
  const db = getDb();

  let gamesResult;
  let lineupsResult;
  let roundResult;
  try {
    roundResult = await getRound(input.roundId);
    if (roundResult.status === "unavailable") return { status: "unavailable", message: roundResult.message };
    if (!roundResult.data) return { status: "invalid", errors: ["This round doesn't exist."] };

    // Cross-sport contamination guard: the round actually belonging to the sport the
    // caller claims to be entering, not just trusted from the request. This is what
    // stops an NRL game from ever being usable inside an AFL competition (or vice
    // versa) even if a client sends a mismatched sportId/roundId pair.
    const seasonResult = await getSeasonById(roundResult.data.seasonId);
    if (seasonResult.status === "unavailable") return { status: "unavailable", message: seasonResult.message };
    if (!seasonResult.data || seasonResult.data.sportId !== input.sportId) {
      return { status: "invalid", errors: ["This round does not belong to the selected sport's competition."] };
    }

    gamesResult = await listGamesForRound(input.roundId);
    if (gamesResult.status === "unavailable") return { status: "unavailable", message: gamesResult.message };

    lineupsResult = await listLineupsForGames(gamesResult.data.map((g) => g.id));
    if (lineupsResult.status === "unavailable") return { status: "unavailable", message: lineupsResult.message };
  } catch (error) {
    return { status: "unavailable", message: error instanceof Error ? error.message : "Unknown error." };
  }

  const games = gamesResult.data;
  const roundGameIds = games.map((g) => g.id);
  const selectionsPerGame = getSelectionConfig(input.sportCode).selectionsPerGame;

  const selectionInputs: SelectionInput[] = input.selections.map((s) => ({
    gameId: s.gameId,
    playerIds: s.playerIds,
  }));

  const roundValidation = validateEntrySelections(roundGameIds, selectionInputs);
  if (!roundValidation.valid) return { status: "invalid", errors: roundValidation.errors };

  const eligibleByGame = new Map<number, Set<number>>();
  for (const lineup of lineupsResult.data) {
    if (!eligibleByGame.has(lineup.gameId)) eligibleByGame.set(lineup.gameId, new Set());
    eligibleByGame.get(lineup.gameId)!.add(lineup.playerId);
  }

  const errors: string[] = [];
  const gameById = new Map(games.map((g) => [g.id, g]));

  for (const selection of input.selections) {
    const game = gameById.get(selection.gameId);
    if (game && isSelectionLocked({ status: game.status, kickoff: game.kickoff })) {
      errors.push(`Selections are locked for the ${game.homeTeam?.name ?? ""} vs ${game.awayTeam?.name ?? ""} game — it has already started.`);
      continue;
    }
    const eligible = eligibleByGame.get(selection.gameId) ?? new Set<number>();
    const result = validateSelection({ gameId: selection.gameId, playerIds: selection.playerIds }, eligible, selectionsPerGame);
    if (!result.valid) errors.push(...result.errors);
  }

  if (errors.length > 0) return { status: "invalid", errors };

  // The authoritative buy-in cutoff — the round's first game kickoff, per
  // src/lib/competitions/lifecycle.ts. Never an arbitrary fixed time, never derived from
  // array order, never client-supplied.
  const firstGameKickoff = computeFirstGameKickoff(games);

  const competitionResult = await getOrCreateCompetition(input.sportId, input.roundId, input.competitionName, firstGameKickoff);
  if (competitionResult.status === "unavailable") return { status: "unavailable", message: competitionResult.message };
  const competition = competitionResult.data;

  // Server-side lock, independent of anything the UI shows: no entry is ever created
  // against a competition that isn't currently open, whether that's because it's been
  // explicitly closed/settled, hasn't opened yet, or its closesAt time has passed.
  if (!canAcceptEntries(competition)) {
    logEvent("cutoff_rejected", { competitionId: competition.id, sportCode: input.sportCode }, "warn");
    return { status: "invalid", errors: [`This ${input.competitionName} round is not currently open for entries.`] };
  }

  try {
    const existingUser = await db.select().from(schema.users).where(eq(schema.users.email, input.userEmail)).limit(1);
    const user =
      existingUser[0] ??
      (await db.insert(schema.users).values({ email: input.userEmail, name: input.userName }).returning())[0];

    // Clean, explicit duplicate-entry rejection rather than surfacing a raw unique-
    // constraint violation from the database to the user.
    const existingEntry = await db
      .select()
      .from(schema.competitionEntries)
      .where(and(eq(schema.competitionEntries.competitionId, competition.id), eq(schema.competitionEntries.userId, user.id)))
      .limit(1);
    if (existingEntry[0]) {
      return { status: "invalid", errors: [`You already have an entry in this ${input.competitionName} round.`] };
    }

    // The payment amount always comes from the competition's own configured price —
    // never from the request — and charging is idempotent per (userId, competitionId)
    // via chargeForEntry (src/lib/data/payment-transactions.ts), so a real processor can
    // replace the dev-only placeholder later without touching anything below this line.
    // A failed/cancelled charge means no entry is created.
    const chargeOutcome = await chargeForEntry(user.id, competition.id, competition.entryFeeCents);
    if (chargeOutcome.status === "unavailable") return { status: "unavailable", message: chargeOutcome.message };
    const { transaction } = chargeOutcome.data;
    if (transaction.status === "failed" || transaction.status === "cancelled") {
      return { status: "invalid", errors: [transaction.failureMessage ?? "Payment could not be processed."] };
    }

    const [entry] = await db
      .insert(schema.competitionEntries)
      .values({
        competitionId: competition.id,
        userId: user.id,
        paymentStatus: transaction.status,
        // Only ever set once money has actually been received — never on "pending".
        paidAmountCents: transaction.status === "paid" ? competition.entryFeeCents : null,
      })
      .returning();

    // Race-safety: two concurrent requests for the same user+competition can both pass
    // the "existingEntry" check above before either commits (classic TOCTOU), and
    // chargeForEntry's idempotency means BOTH would see the same single successful
    // transaction — without this guard, both would then insert their own entry row here,
    // producing two "paid" entries from one real charge. This UPDATE ... WHERE
    // competition_entry_id IS NULL is the same atomic-conditional-update pattern used for
    // prize-settlement idempotency (see settlement.ts): only the first caller to reach it
    // can ever win the claim, so at most one entry per transaction survives.
    const claimed = await db
      .update(schema.paymentTransactions)
      .set({ competitionEntryId: entry.id, updatedAt: new Date() })
      .where(and(eq(schema.paymentTransactions.id, transaction.id), isNull(schema.paymentTransactions.competitionEntryId)))
      .returning();

    if (!claimed[0]) {
      // Lost the race — a concurrent request already created and linked the real entry
      // for this transaction. Roll back this speculative row (cascades to any selections,
      // though none are inserted yet at this point) rather than leaving an orphan behind.
      await db.delete(schema.competitionEntries).where(eq(schema.competitionEntries.id, entry.id));
      return { status: "invalid", errors: [`You already have an entry in this ${input.competitionName} round.`] };
    }

    // Narrow self-healing check: `entry.paymentStatus` above was captured from the
    // transaction's status at charge time, a moment before this claim — if a real
    // provider's webhook happened to confirm "paid" in that brief window (before this
    // entry even existed to be linked), applyWebhookEventToTransaction had no entry yet to
    // update. `claimed[0]` (this same transaction, re-read via the claim's own RETURNING)
    // reflects its truly current status, so correct the entry here if it's now paid but
    // was inserted showing "pending" — the other, far more common direction (a webhook
    // arriving after this entry already exists) is handled entirely by
    // applyWebhookEventToTransaction itself.
    if (claimed[0].status === "paid" && entry.paymentStatus !== "paid") {
      await db.update(schema.competitionEntries).set({ paymentStatus: "paid", paidAmountCents: claimed[0].amountCents }).where(eq(schema.competitionEntries.id, entry.id));
    }

    await db.insert(schema.entrySelections).values(
      input.selections.map((s) => ({
        entryId: entry.id,
        gameId: s.gameId,
        selectedPlayer1Id: s.playerIds[0],
        // Null for every current (1-pick) sport. Only ever set for a genuinely
        // 2-selection sport config, which no sport uses since Phase 23F.
        selectedPlayer2Id: s.playerIds[1] ?? null,
      })),
    );

    logEvent("entry_created", { entryId: entry.id, competitionId: competition.id, sportCode: input.sportCode });
    return { status: "ok", entryId: entry.id };
  } catch (error) {
    return { status: "unavailable", message: error instanceof Error ? error.message : "Unknown error." };
  }
}

export interface SelectedPlayerDisplay {
  id: number;
  name: string;
  /** The sport's required stat count (tries/goals/touchdowns/points) for this game — null if not final yet. */
  statCount: number | null;
  result: SelectionResult;
}

export interface EntrySelectionSettlement {
  gameId: number;
  homeTeamName: string;
  awayTeamName: string;
  gameStatus: GameStatus;
  /** One entry per selection made for this game — length 1 for every current sport, length 2 for a historical entry. */
  selections: SelectedPlayerDisplay[];
  gameResult: GameSelectionResult;
}

export interface EntryWithResult {
  entryId: number;
  userId: number;
  sportCode: string;
  competitionId: number;
  roundId: number;
  /** e.g. "tries" for NRL, "goals" for AFL, "points" for NBA — used to phrase results ("1 try", "24 points"). */
  statField: "tries" | "goals" | "points" | "touchdowns";
  entryResult: EntryResult;
  selections: EntrySelectionSettlement[];
}

/**
 * Loads an entry, settles every selection against the game's actual stats (real data
 * only — never fabricated), persists the freshly-computed results, and returns them.
 * Games that haven't finished yet simply stay "pending" — this never guesses a result.
 */
export async function getEntryWithResult(entryId: number): Promise<DataResult<EntryWithResult | null>> {
  return safeQuery(async () => {
    const db = getDb();

    const entryRows = await db.select().from(schema.competitionEntries).where(eq(schema.competitionEntries.id, entryId)).limit(1);
    const entry = entryRows[0];
    if (!entry) return null;

    const [competitionRows, selectionRows] = await Promise.all([
      db.select().from(schema.competitions).where(eq(schema.competitions.id, entry.competitionId)).limit(1),
      db.select().from(schema.entrySelections).where(eq(schema.entrySelections.entryId, entryId)),
    ]);
    const competition = competitionRows[0];
    const sportRows = await db.select().from(schema.sports).where(eq(schema.sports.id, competition.sportId)).limit(1);
    const sportCode = sportRows[0].code;
    const selectionConfig = getSelectionConfig(sportCode);
    const statField = selectionConfig.statField;

    const gameIds = selectionRows.map((s) => s.gameId);
    const playerIds = Array.from(
      new Set(selectionRows.flatMap((s) => [s.selectedPlayer1Id, s.selectedPlayer2Id].filter((id): id is number => id != null))),
    );
    const [games, stats, players] = await Promise.all([
      gameIds.length ? db.select().from(schema.games).where(inArray(schema.games.id, gameIds)) : Promise.resolve([]),
      gameIds.length
        ? db.select().from(schema.playerGameStats).where(inArray(schema.playerGameStats.gameId, gameIds))
        : Promise.resolve([]),
      playerIds.length ? db.select().from(schema.players).where(inArray(schema.players.id, playerIds)) : Promise.resolve([]),
    ]);
    const gameById = new Map(games.map((g) => [g.id, g]));
    const statByGameAndPlayer = new Map(stats.map((s) => [`${s.gameId}:${s.playerId}`, s]));
    const playerById = new Map(players.map((p) => [p.id, p]));

    const teamIds = Array.from(new Set(games.flatMap((g) => [g.homeTeamId, g.awayTeamId])));
    const teams = teamIds.length ? await db.select().from(schema.teams).where(inArray(schema.teams.id, teamIds)) : [];
    const teamById = new Map(teams.map((t) => [t.id, t]));
    const playerDisplayName = (id: number) => {
      const p = playerById.get(id);
      return p ? `${p.firstName} ${p.lastName}` : "Unknown player";
    };

    // Immutability + roll-up logic lives in one shared place — see settleEntrySelections
    // (src/lib/perfect2/settle.ts) and docs/stage8 §9 / docs/phase9-10 for the reasoning.
    const { selections: settledCore, entryResult } = settleEntrySelections(
      selectionRows.map((s) => ({
        gameId: s.gameId,
        selections: [
          { playerId: s.selectedPlayer1Id, storedResult: s.player1Result },
          ...(s.selectedPlayer2Id != null ? [{ playerId: s.selectedPlayer2Id, storedResult: s.player2Result ?? "pending" }] : []),
        ],
      })),
      (gameId) => gameById.get(gameId)?.status === "final",
      (gameId, playerId) => statByGameAndPlayer.get(`${gameId}:${playerId}`)?.[statField],
      selectionConfig.targetThreshold,
    );
    const settled: EntrySelectionSettlement[] = settledCore.map((s) => {
      const game = gameById.get(s.gameId);
      return {
        gameId: s.gameId,
        homeTeamName: game ? (teamById.get(game.homeTeamId)?.name ?? "TBC") : "TBC",
        awayTeamName: game ? (teamById.get(game.awayTeamId)?.name ?? "TBC") : "TBC",
        gameStatus: game?.status ?? "scheduled",
        selections: s.selections.map((sel) => {
          const stat = statByGameAndPlayer.get(`${s.gameId}:${sel.playerId}`);
          return {
            id: sel.playerId,
            name: playerDisplayName(sel.playerId),
            statCount: stat ? stat[statField] : null,
            result: sel.result,
          };
        }),
        gameResult: s.gameResult,
      };
    });

    // Persist the freshly-computed results so reads stay cheap between syncs.
    await Promise.all(
      selectionRows.map((s, i) => {
        const settledGame = settled[i];
        const player1Result = settledGame.selections[0]?.result ?? "pending";
        const player2Result = s.selectedPlayer2Id != null ? (settledGame.selections[1]?.result ?? "pending") : null;
        return db.update(schema.entrySelections).set({ player1Result, player2Result }).where(eq(schema.entrySelections.id, s.id));
      }),
    );
    if (entryResult !== entry.result) {
      await db.update(schema.competitionEntries).set({ result: entryResult }).where(eq(schema.competitionEntries.id, entryId));
    }

    return {
      entryId,
      userId: entry.userId,
      sportCode,
      competitionId: competition.id,
      roundId: competition.roundId,
      statField,
      entryResult,
      selections: settled,
    };
  });
}

export interface UserRoundEntrySummary {
  entryId: number;
  result: EntryResult;
  paymentStatus: string;
  paidAmountCents: number | null;
  enteredAt: Date;
}

/**
 * Every entry this user holds in ONE specific competition (sport+round) — the "Your
 * entries X/10" list. Each row is fully independent (own paidAmountCents, own result); a
 * 5-entry package purchase produces 5 separate rows here, never one combined row.
 */
export async function listUserEntriesForCompetition(userId: number, competitionId: number): Promise<DataResult<UserRoundEntrySummary[]>> {
  return safeQuery(async () => {
    const rows = await getDb()
      .select()
      .from(schema.competitionEntries)
      .where(and(eq(schema.competitionEntries.competitionId, competitionId), eq(schema.competitionEntries.userId, userId)))
      .orderBy(desc(schema.competitionEntries.enteredAt));
    return rows.map((r) => ({
      entryId: r.id,
      result: r.result,
      paymentStatus: r.paymentStatus,
      paidAmountCents: r.paidAmountCents,
      enteredAt: r.enteredAt,
    }));
  });
}

/**
 * The user's existing selection set for one competition, if they already hold at least
 * one entry there — every entry in a competition holds an identical copy (see
 * purchaseEntryPackage's "one shared selection set" model), so the first one found is
 * authoritative for all of them. Returns null when the user has no entries yet (a fresh
 * selection is required in that case). Used both to let "buy more entries" skip the
 * picking screen entirely, and — authoritatively, server-side — to make it impossible for
 * a client to submit a second, different selection set for a round it already entered.
 */
export async function getUserSelectionsForCompetition(userId: number, competitionId: number): Promise<DataResult<EntrySelectionInput[] | null>> {
  return safeQuery(async () => {
    const db = getDb();
    const anyEntry = await db
      .select({ id: schema.competitionEntries.id })
      .from(schema.competitionEntries)
      .where(and(eq(schema.competitionEntries.competitionId, competitionId), eq(schema.competitionEntries.userId, userId)))
      .orderBy(schema.competitionEntries.id)
      .limit(1);
    if (!anyEntry[0]) return null;
    const rows = await db.select().from(schema.entrySelections).where(eq(schema.entrySelections.entryId, anyEntry[0].id));
    return rows.map((r) => ({
      gameId: r.gameId,
      playerIds: [r.selectedPlayer1Id, ...(r.selectedPlayer2Id != null ? [r.selectedPlayer2Id] : [])],
    }));
  });
}

export interface UserEntryGroupSummary {
  competitionId: number;
  sportCode: string;
  roundId: number;
  roundName: string | null;
  roundNumber: number;
  /** Every entry ID in this group — the individual, independently-settleable entries underlying "N ENTRIES, SAME PICKS" (see purchaseEntryPackage's doc comment). */
  entryIds: number[];
  /** Guaranteed identical across every entry in the group — they share one canonical selection set, so they always settle to the exact same result. */
  result: EntryResult;
  enteredAt: Date;
  /** Sum of this group's entries' prizeAllocationCents — 0 unless every entry is PERFECT and the competition has settled. */
  totalPrizeAllocationCents: number;
  /** The competition's total PERFECT-entry count at settlement (0 before settlement) — lets the UI show "N of Y total PERFECT entries" (this customer's shares of the pool). */
  competitionWinnerCount: number;
}

/**
 * Every entry a user holds, GROUPED by competition (sport + round) — the "My Entries"
 * product view: a 10-entry package purchase is one group of 10 entryIds sharing one
 * result, never ten separate rows that look like ten different bets. Each underlying
 * entry ID remains individually visible (entryIds) and independently settled — this is
 * purely a display grouping, never a schema change.
 */
export async function listEntryGroupsForUser(userId: number): Promise<DataResult<UserEntryGroupSummary[]>> {
  return safeQuery(async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.competitionEntries)
      .where(eq(schema.competitionEntries.userId, userId))
      .orderBy(desc(schema.competitionEntries.enteredAt));
    if (rows.length === 0) return [];

    const competitionIds = Array.from(new Set(rows.map((r) => r.competitionId)));
    const competitions = await db.select().from(schema.competitions).where(inArray(schema.competitions.id, competitionIds));
    const competitionById = new Map(competitions.map((c) => [c.id, c]));

    const sportIds = Array.from(new Set(competitions.map((c) => c.sportId)));
    const roundIds = Array.from(new Set(competitions.map((c) => c.roundId)));
    const [sports, rounds] = await Promise.all([
      sportIds.length ? db.select().from(schema.sports).where(inArray(schema.sports.id, sportIds)) : Promise.resolve([]),
      roundIds.length ? db.select().from(schema.rounds).where(inArray(schema.rounds.id, roundIds)) : Promise.resolve([]),
    ]);
    const sportById = new Map(sports.map((s) => [s.id, s]));
    const roundById = new Map(rounds.map((r) => [r.id, r]));

    const groups = new Map<number, UserEntryGroupSummary>();
    for (const r of rows) {
      const competition = competitionById.get(r.competitionId);
      const round = competition ? roundById.get(competition.roundId) : undefined;
      const sport = competition ? sportById.get(competition.sportId) : undefined;
      const existing = groups.get(r.competitionId);
      if (existing) {
        existing.entryIds.push(r.id);
        existing.totalPrizeAllocationCents += r.prizeAllocationCents;
        if (r.enteredAt > existing.enteredAt) existing.enteredAt = r.enteredAt;
      } else {
        groups.set(r.competitionId, {
          competitionId: r.competitionId,
          sportCode: sport?.code ?? "unknown",
          roundId: round?.id ?? 0,
          roundName: round?.name ?? null,
          roundNumber: round?.roundNumber ?? 0,
          entryIds: [r.id],
          result: r.result,
          enteredAt: r.enteredAt,
          totalPrizeAllocationCents: r.prizeAllocationCents,
          competitionWinnerCount: competition?.winnerCount ?? 0,
        });
      }
    }
    return Array.from(groups.values()).sort((a, b) => b.enteredAt.getTime() - a.enteredAt.getTime());
  });
}

export interface UserEntrySummary {
  entryId: number;
  competitionId: number;
  sportCode: string;
  roundId: number;
  roundName: string | null;
  roundNumber: number;
  result: EntryResult;
  enteredAt: Date;
}

/**
 * Every entry belonging to one user, newest first — the mobile "My Entries" list. Joins
 * through to sport/round so the client can group/label entries (e.g. "NRL — Round 5")
 * without a second round-trip per entry.
 */
export async function listEntriesForUser(userId: number): Promise<DataResult<UserEntrySummary[]>> {
  return safeQuery(async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.competitionEntries)
      .where(eq(schema.competitionEntries.userId, userId))
      .orderBy(desc(schema.competitionEntries.enteredAt));
    if (rows.length === 0) return [];

    const competitionIds = Array.from(new Set(rows.map((r) => r.competitionId)));
    const competitions = await db.select().from(schema.competitions).where(inArray(schema.competitions.id, competitionIds));
    const competitionById = new Map(competitions.map((c) => [c.id, c]));

    const sportIds = Array.from(new Set(competitions.map((c) => c.sportId)));
    const roundIds = Array.from(new Set(competitions.map((c) => c.roundId)));
    const [sports, rounds] = await Promise.all([
      sportIds.length ? db.select().from(schema.sports).where(inArray(schema.sports.id, sportIds)) : Promise.resolve([]),
      roundIds.length ? db.select().from(schema.rounds).where(inArray(schema.rounds.id, roundIds)) : Promise.resolve([]),
    ]);
    const sportById = new Map(sports.map((s) => [s.id, s]));
    const roundById = new Map(rounds.map((r) => [r.id, r]));

    return rows.map((r) => {
      const competition = competitionById.get(r.competitionId);
      const round = competition ? roundById.get(competition.roundId) : undefined;
      const sport = competition ? sportById.get(competition.sportId) : undefined;
      return {
        entryId: r.id,
        competitionId: r.competitionId,
        sportCode: sport?.code ?? "unknown",
        roundId: round?.id ?? 0,
        roundName: round?.name ?? null,
        roundNumber: round?.roundNumber ?? 0,
        result: r.result,
        enteredAt: r.enteredAt,
      };
    });
  });
}
