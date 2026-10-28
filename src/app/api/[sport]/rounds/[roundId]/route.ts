import { getSportConfig } from "@/lib/sports/config";
import { getRound } from "@/lib/data/rounds";
import { listGamesForRound, listEligiblePlayersForRound } from "@/lib/data/games";
import { getSportByCode } from "@/lib/data/sports";
import { getCompetitionForRound, previewUnclaimedRolloverCents } from "@/lib/data/competitions";
import { computeFirstGameKickoff, getEffectiveCompetitionState, hasFirstGameKickedOff } from "@/lib/competitions/lifecycle";
import { getSelectionConfig } from "@/lib/perfect2/registry";
import { apiNotFound, apiOk, apiUnavailable } from "@/lib/api/response";

const DEFAULT_COMPETITION_PREVIEW = { status: "open" as const, opensAt: null, closesAt: null, entryFeeCents: 500, prizeAmountCents: 6000 };

/**
 * One round-trip for the mobile "view round / start an entry" screen: round info, every
 * game with its full eligible-player pool (no position filter), and the competition's
 * current entry price/state. All money/status values are server-authoritative — the
 * client never invents or overrides them.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ sport: string; roundId: string }> }) {
  const { sport: sportSlug, roundId: roundIdParam } = await params;
  const sport = getSportConfig(sportSlug);
  if (!sport) return apiNotFound("Sport");

  const roundId = Number(roundIdParam);
  if (!Number.isInteger(roundId)) return apiNotFound("Round");

  const roundResult = await getRound(roundId);
  if (roundResult.status === "unavailable") return apiUnavailable();
  if (!roundResult.data) return apiNotFound("Round");
  const round = roundResult.data;

  const [gamesResult, eligibleResult, sportResult] = await Promise.all([
    listGamesForRound(roundId),
    listEligiblePlayersForRound(roundId),
    getSportByCode(sport.code),
  ]);
  if (gamesResult.status === "unavailable" || eligibleResult.status === "unavailable") return apiUnavailable();

  let competition = DEFAULT_COMPETITION_PREVIEW as {
    status: "open" | "closed" | "settled";
    opensAt: Date | null;
    closesAt: Date | null;
    entryFeeCents: number;
    prizeAmountCents: number;
  };
  /** Real rolloverInCents once a competition row exists; a read-only preview until then (see previewUnclaimedRolloverCents). */
  let rolloverInCents = 0;
  if (sportResult.status === "ok" && sportResult.data) {
    const competitionResult = await getCompetitionForRound(sportResult.data.id, roundId);
    if (competitionResult.status === "ok" && competitionResult.data) {
      competition = competitionResult.data;
      rolloverInCents = competitionResult.data.rolloverInCents;
    } else {
      rolloverInCents = await previewUnclaimedRolloverCents(sportResult.data.id, roundId);
    }
  }

  const selectionConfig = getSelectionConfig(sport.code);

  // Phase 21: the authoritative buy-in cutoff / prize-pool-reveal moment — the round's
  // first game kickoff, computed the same way everywhere (never client-supplied, never
  // array order). The pool amount itself is withheld from the response entirely (null,
  // not just hidden client-side) until that instant has passed.
  const firstGameKickoffAt = computeFirstGameKickoff(gamesResult.data);
  const prizePoolVisible = hasFirstGameKickedOff(firstGameKickoffAt);

  return apiOk({
    round: {
      id: round.id,
      roundNumber: round.roundNumber,
      name: round.name,
      startDate: round.startDate,
      endDate: round.endDate,
      status: round.status,
    },
    competition: {
      state: getEffectiveCompetitionState(competition),
      entryFeeCents: competition.entryFeeCents,
      /** Configured base prize — null until prizePoolVisible, exactly like currentPrizePoolCents (Phase 23H: this used to leak unconditionally even though currentPrizePoolCents was already correctly gated). */
      prizeAmountCents: prizePoolVisible ? competition.prizeAmountCents : null,
      /** Whether currentPrizePoolCents may be shown yet — false until the round's first game kicks off. */
      prizePoolVisible,
      /** Base prize + any rollover (Phase 19) — null until prizePoolVisible is true. */
      currentPrizePoolCents: prizePoolVisible ? competition.prizeAmountCents + rolloverInCents : null,
      opensAt: competition.opensAt,
      closesAt: competition.closesAt,
      firstGameKickoffAt,
      buyInCutoffAt: firstGameKickoffAt,
    },
    selectionLabel: selectionConfig.selectionLabel,
    /** Server-authoritative rule config — mobile derives its picking UI/copy from this, never hardcodes sport rules. */
    ruleConfig: {
      sport: sport.code,
      requiredGames: gamesResult.data.length,
      selectionsPerGame: selectionConfig.selectionsPerGame,
      selectionMetric: selectionConfig.statField,
      threshold: selectionConfig.targetThreshold,
    },
    games: gamesResult.data.map((game) => ({
      id: game.id,
      homeTeam: { id: game.homeTeamId, name: game.homeTeam?.name ?? "TBC", logoUrl: game.homeTeam?.logoUrl ?? null },
      awayTeam: { id: game.awayTeamId, name: game.awayTeam?.name ?? "TBC", logoUrl: game.awayTeam?.logoUrl ?? null },
      kickoff: game.kickoff,
      venue: game.venue,
      status: game.status,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      /** Which curated round "day" this game was assigned to (e.g. "thursday") — only set for sports that curate a round out of a larger schedule (NBA). Null/unused for NRL/AFL. */
      slotLabel: game.slotLabel,
      eligiblePlayers: (eligibleResult.data.get(game.id) ?? []).map((p) => ({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        position: p.position,
        teamId: p.teamId,
        photoUrl: p.photoUrl ?? null,
        /** Real provider-reported designation (never "OUT" — those are already excluded server-side) — e.g. "DAY_TO_DAY", or null for no designation. Display-only warning, never an exclusion signal on the client. */
        injuryStatus: p.injuryStatus,
      })),
    })),
  });
}
