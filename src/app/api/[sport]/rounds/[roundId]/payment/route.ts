import { getSportConfig } from "@/lib/sports/config";
import { getSportByCode } from "@/lib/data/sports";
import { getRound } from "@/lib/data/rounds";
import { getSeasonById } from "@/lib/data/seasons";
import { listGamesForRound } from "@/lib/data/games";
import { getOrCreateCompetition } from "@/lib/data/competitions";
import { computeFirstGameKickoff, getEffectiveCompetitionState } from "@/lib/competitions/lifecycle";
import { chargeForEntry } from "@/lib/data/payment-transactions";
import { getRequestUser } from "@/lib/auth/require";
import { getDb, schema } from "@/db";
import { and, eq } from "drizzle-orm";
import { apiError, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

/**
 * Pre-flight "test payment" step for the buy-in flow (docs/phase16-buy-in-flow.md §17):
 * validates eligibility and runs a payment attempt via chargeForEntry
 * (src/lib/data/payment-transactions.ts) for the exact competition. Because chargeForEntry
 * is idempotent per (userId, competitionId), this call and the one createEntry makes at
 * final submission (POST .../entries) resolve to the SAME underlying payment_transactions
 * row — this route is a UX gate that also happens to be where the first real attempt is
 * recorded, never the authoritative entry record, and it never writes to
 * competition_entries. Every value used (sport, round, competition, price) is resolved
 * server-side from the URL + DB; nothing is accepted from the request body, so the client
 * cannot manipulate price or competition.
 */
export async function POST(request: Request, { params }: { params: Promise<{ sport: string; roundId: string }> }) {
  const { sport: sportSlug, roundId: roundIdParam } = await params;
  const sport = getSportConfig(sportSlug);
  if (!sport) return apiNotFound("Sport");

  const roundId = Number(roundIdParam);
  if (!Number.isInteger(roundId)) return apiNotFound("Round");

  const user = await getRequestUser(request);
  if (!user) return apiUnauthorized();

  const roundResult = await getRound(roundId);
  if (roundResult.status === "unavailable") return apiUnavailable();
  if (!roundResult.data) return apiNotFound("Round");

  // Cross-sport contamination guard — same check createEntry performs, applied here too
  // so a mismatched sportId/roundId pair is rejected before a charge is even attempted.
  const [seasonResult, sportResult] = await Promise.all([getSeasonById(roundResult.data.seasonId), getSportByCode(sport.code)]);
  if (seasonResult.status === "unavailable" || sportResult.status === "unavailable") return apiUnavailable();
  if (!sportResult.data || !seasonResult.data || seasonResult.data.sportId !== sportResult.data.id) {
    return apiError(422, "This round does not belong to the selected sport's competition.");
  }

  // Same authoritative cutoff createEntry uses (src/lib/data/entries.ts) — the round's
  // first game kickoff, computed the same way everywhere, never re-derived ad hoc. Without
  // this, a competition first created via THIS route (before any entry exists) would get
  // closesAt=null and its buy-in cutoff would never be enforced.
  const gamesResult = await listGamesForRound(roundId);
  if (gamesResult.status === "unavailable") return apiUnavailable();
  const firstGameKickoff = computeFirstGameKickoff(gamesResult.data);

  const competitionResult = await getOrCreateCompetition(sportResult.data.id, roundId, `Perfect Play ${sport.name}`, firstGameKickoff);
  if (competitionResult.status === "unavailable") return apiUnavailable();
  const competition = competitionResult.data;

  const state = getEffectiveCompetitionState(competition);
  if (state !== "open") {
    const message =
      state === "closed"
        ? "This competition is no longer accepting entries."
        : state === "settled"
          ? "This competition has already been settled."
          : "This competition is not open for entries yet.";
    return apiError(422, message);
  }

  const db = getDb();
  const existing = await db
    .select()
    .from(schema.competitionEntries)
    .where(and(eq(schema.competitionEntries.competitionId, competition.id), eq(schema.competitionEntries.userId, user.id)))
    .limit(1);
  if (existing[0]) return apiError(409, "You've already entered this competition.");

  const chargeOutcome = await chargeForEntry(user.id, competition.id, competition.entryFeeCents);
  if (chargeOutcome.status === "unavailable") return apiUnavailable();
  const { transaction } = chargeOutcome.data;

  return apiOk({
    status: transaction.status,
    amountCents: competition.entryFeeCents,
    currency: "AUD" as const,
    message: transaction.failureMessage ?? "Payment recorded.",
  });
}
