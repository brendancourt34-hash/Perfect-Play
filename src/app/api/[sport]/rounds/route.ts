import { getSportConfig } from "@/lib/sports/config";
import { getSportByCode } from "@/lib/data/sports";
import { getCurrentSeason, listSeasons } from "@/lib/data/seasons";
import { listRounds } from "@/lib/data/rounds";
import { listGamesForRound } from "@/lib/data/games";
import { getCompetitionForRound } from "@/lib/data/competitions";
import { computeFirstGameKickoff, getEffectiveCompetitionState, hasFirstGameKickedOff } from "@/lib/competitions/lifecycle";
import { apiNotFound, apiOk, apiUnavailable } from "@/lib/api/response";

export async function GET(_request: Request, { params }: { params: Promise<{ sport: string }> }) {
  const { sport: sportSlug } = await params;
  const sport = getSportConfig(sportSlug);
  if (!sport) return apiNotFound("Sport");

  const sportResult = await getSportByCode(sport.code);
  if (sportResult.status === "unavailable") return apiUnavailable();
  if (!sportResult.data) return apiOk({ rounds: [] });

  const currentSeasonResult = await getCurrentSeason(sportResult.data.id);
  let season = currentSeasonResult.status === "ok" ? currentSeasonResult.data : null;
  if (!season) {
    const seasons = await listSeasons(sportResult.data.id);
    season = seasons.status === "ok" ? (seasons.data[0] ?? null) : null;
  }
  if (!season) return apiOk({ rounds: [] });

  const roundsResult = await listRounds(season.id);
  if (roundsResult.status === "unavailable") return apiUnavailable();

  // Read-only per-round competition summary (state/entry fee/prize/dates) — the mobile
  // round-list screen displays this so the user can see price and status before opening a
  // round, matching how the round-detail endpoint already exposes the same fields. Never
  // creates a competition row; a round with none yet simply gets null here.
  const [competitions, gamesPerRound] = await Promise.all([
    Promise.all(roundsResult.data.map((r) => (sportResult.data ? getCompetitionForRound(sportResult.data.id, r.id) : Promise.resolve(null)))),
    Promise.all(roundsResult.data.map((r) => listGamesForRound(r.id))),
  ]);

  return apiOk({
    season: { id: season.id, year: season.year, label: season.label },
    rounds: roundsResult.data.map((r, i) => {
      const competitionResult = competitions[i];
      const competition = competitionResult && competitionResult.status === "ok" ? competitionResult.data : null;
      const gamesResult = gamesPerRound[i];
      const games = gamesResult.status === "ok" ? gamesResult.data : [];
      const firstGameKickoffAt = computeFirstGameKickoff(games);
      // Phase 21 product rule: the current prize pool is never publicly shown before the
      // round's first game kicks off — no matter what the client asks for or already has
      // cached, this decision is made here, server-side, from the real game data.
      const prizePoolVisible = hasFirstGameKickedOff(firstGameKickoffAt);

      return {
        id: r.id,
        roundNumber: r.roundNumber,
        name: r.name,
        startDate: r.startDate,
        endDate: r.endDate,
        status: r.status,
        gamesCount: games.length,
        competition: competition
          ? {
              state: getEffectiveCompetitionState(competition),
              entryFeeCents: competition.entryFeeCents,
              /** Configured base prize — null until prizePoolVisible, exactly like currentPrizePoolCents. */
              prizeAmountCents: prizePoolVisible ? competition.prizeAmountCents : null,
              /** Whether currentPrizePoolCents may be shown yet — false until the round's first game kicks off. */
              prizePoolVisible,
              /** Base prize + any rollover already applied (Phase 19) — null until prizePoolVisible is true. */
              currentPrizePoolCents: prizePoolVisible ? competition.prizeAmountCents + competition.rolloverInCents : null,
              opensAt: competition.opensAt,
              closesAt: competition.closesAt,
              firstGameKickoffAt,
              buyInCutoffAt: firstGameKickoffAt,
            }
          : null,
      };
    }),
  });
}
