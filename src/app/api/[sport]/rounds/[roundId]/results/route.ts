import { getSportConfig } from "@/lib/sports/config";
import { getSportByCode } from "@/lib/data/sports";
import { getCompetitionForRound } from "@/lib/data/competitions";
import { listGamesForRound } from "@/lib/data/games";
import { getCompetitionResultsSummary } from "@/lib/data/settlement";
import { listUserEntriesForCompetition } from "@/lib/data/entries";
import { computeFirstGameKickoff, getEffectiveCompetitionState, hasFirstGameKickedOff } from "@/lib/competitions/lifecycle";
import { getRequestUser } from "@/lib/auth/require";
import { apiNotFound, apiOk, apiUnavailable } from "@/lib/api/response";

/**
 * Customer-facing results — NEVER exposes entrant count, live turnover, or a live payout
 * estimate (Feature 2/5). Before the competition is settled, `results` carries only the
 * Prize Pool state; PERFECT-entry counts, the winner list, and payout-per-entry are
 * settlement information and only ever appear once `settled` is true. `myPerfectEntryCount`/
 * `mySharesAmountCents` are the signed-in caller's OWN result — never another customer's —
 * and are 0 for an anonymous request or before settlement.
 */
export async function GET(request: Request, { params }: { params: Promise<{ sport: string; roundId: string }> }) {
  const { sport: sportSlug, roundId: roundIdParam } = await params;
  const sport = getSportConfig(sportSlug);
  if (!sport) return apiNotFound("Sport");

  const roundId = Number(roundIdParam);
  if (!Number.isInteger(roundId)) return apiNotFound("Round");

  const sportResult = await getSportByCode(sport.code);
  if (sportResult.status === "unavailable") return apiUnavailable();
  if (!sportResult.data) return apiOk({ competition: null, results: null });

  const competitionResult = await getCompetitionForRound(sportResult.data.id, roundId);
  if (competitionResult.status === "unavailable") return apiUnavailable();
  if (!competitionResult.data) return apiOk({ competition: null, results: null });
  const competition = competitionResult.data;

  const [summaryResult, gamesResult, user] = await Promise.all([
    getCompetitionResultsSummary(competition.id),
    listGamesForRound(roundId),
    getRequestUser(request),
  ]);
  if (summaryResult.status === "unavailable") return apiUnavailable();
  if (gamesResult.status === "unavailable") return apiUnavailable();

  // Same rule as the round/round-list endpoints: the pool amount is withheld entirely
  // until the round's first game has kicked off, even here — defense in depth in case
  // this endpoint is ever reached directly before a competition is actually settled.
  const prizePoolVisible = hasFirstGameKickedOff(computeFirstGameKickoff(gamesResult.data));
  const state = getEffectiveCompetitionState(competition);
  const settled = state === "settled";

  let myPerfectEntryCount = 0;
  if (settled && user) {
    const myEntriesResult = await listUserEntriesForCompetition(user.id, competition.id);
    if (myEntriesResult.status === "ok") myPerfectEntryCount = myEntriesResult.data.filter((e) => e.result === "perfect").length;
  }

  const currentPrizePoolCents = summaryResult.data && prizePoolVisible ? summaryResult.data.currentPrizePoolCents : null;
  const payoutPerPerfectEntryCents = settled ? (summaryResult.data?.payoutPerPerfectEntryCents ?? null) : null;

  return apiOk({
    competition: {
      id: competition.id,
      state,
      prizeAmountCents: prizePoolVisible ? competition.prizeAmountCents : null,
      prizePoolVisible,
      currentPrizePoolCents: prizePoolVisible ? competition.prizeAmountCents + competition.rolloverInCents : null,
    },
    results: summaryResult.data
      ? {
          competitionId: summaryResult.data.competitionId,
          sportCode: summaryResult.data.sportCode,
          currentPrizePoolCents,
          settled,
          // Settlement information only — never populated before `settled` is true, and
          // never an entrant count, live turnover figure, or live payout estimate.
          perfectCount: settled ? summaryResult.data.perfectCount : null,
          awardedAmountCents: settled ? summaryResult.data.awardedAmountCents : null,
          payoutPerPerfectEntryCents,
          perfectEntryIds: settled ? summaryResult.data.perfectEntryIds : [],
          myPerfectEntryCount,
          mySharesAmountCents: myPerfectEntryCount > 0 && payoutPerPerfectEntryCents ? myPerfectEntryCount * payoutPerPerfectEntryCents : 0,
        }
      : null,
  });
}
