import { requireAdmin } from "@/lib/auth/require";
import { getSportByCode } from "@/lib/data/sports";
import { assignCandidatesToRound, createRound } from "@/lib/data/schedule-pool";
import { validateRoundShape } from "@/lib/perfect2/round-shape";
import { getNbaSportsDataProvider, getNflSportsDataProvider, getSportsDataProvider } from "@/lib/sports-data/registry";
import { syncPlayerEligibilityForGames } from "@/lib/sports-data/sync";
import { logAdminAction } from "@/lib/admin/audit-log";
import { apiError, apiForbidden, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

interface CreateRoundBody {
  sportCode?: string;
  seasonId?: number;
  roundNumber?: number;
  name?: string;
  startDate?: string;
  endDate?: string;
  assignments?: { gameId: number; slotLabel: string | null }[];
}

/**
 * Creates a real, customer-facing Perfect Play round from curated real games picked out of
 * the schedule pool (GET /api/admin/rounds/candidates) — generic across every sport.
 * Game COUNT is never hard-coded here: NRL/AFL are unconstrained (any number of games —
 * 8 in a normal week, 6 during State of Origin/a bye-heavy week, or any other count);
 * only NBA has an actually-enforced shape (exactly 8 games, 2 per day, Thursday-Sunday).
 * See src/lib/perfect2/round-shape.ts. Shape is validated BEFORE anything is written — an
 * invalid assignment never creates a half-built round. Every game must already be a real,
 * previously-synced schedule-pool row; nothing here invents a game.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  let body: CreateRoundBody;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Malformed request body.");
  }
  const { sportCode, seasonId, roundNumber, name, startDate, endDate, assignments } = body;
  if (!sportCode || !seasonId || !roundNumber || !name || !startDate || !endDate || !assignments || assignments.length === 0) {
    return apiError(400, "sportCode, seasonId, roundNumber, name, startDate, endDate, and at least one assignment are all required.");
  }

  const sportResult = await getSportByCode(sportCode);
  if (sportResult.status === "unavailable") return apiUnavailable();
  if (!sportResult.data) return apiNotFound(`Sport "${sportCode}" (sync its schedule first)`);

  // Validate BEFORE creating a round row — an invalid assignment leaves nothing behind.
  const shapeCheck = validateRoundShape(sportCode, assignments);
  if (!shapeCheck.valid) return apiError(422, `Invalid ${sportCode.toUpperCase()} round shape.`, shapeCheck.errors);

  const roundResult = await createRound({ sportId: sportResult.data.id, seasonId, roundNumber, name, startDate, endDate });
  if (roundResult.status === "unavailable") return apiUnavailable();
  const round = roundResult.data;

  const assignResult = await assignCandidatesToRound(sportCode, round.id, assignments);
  if (assignResult.status === "invalid") {
    logAdminAction(`${sportCode}_create_round`, auth.user.id, round.id, "failed", assignResult.errors.join("; "));
    return apiError(422, "Round created but games could not be fully assigned.", assignResult.errors);
  }
  if (assignResult.status === "unavailable") return apiUnavailable();

  // A round's games are useless for entries until each game's real player eligibility
  // pool (roster + game-player association) is synced too — schedule sync alone only
  // covers the games/teams themselves. Only synced for the games actually curated into
  // this round, not every candidate still sitting in the pool.
  let eligibilitySummary = { inserted: 0, updated: 0, errors: [] as string[] };
  try {
    const provider = sportCode === "nba" ? getNbaSportsDataProvider() : sportCode === "nfl" ? getNflSportsDataProvider() : getSportsDataProvider();
    eligibilitySummary = await syncPlayerEligibilityForGames(provider, sportCode, assignments.map((a) => a.gameId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Player eligibility sync failed.";
    logAdminAction(`${sportCode}_create_round`, auth.user.id, round.id, "failed", `round created (id=${round.id}) but player eligibility sync failed: ${message}`);
    return apiError(502, `Round created (id=${round.id}), but syncing player eligibility for its games failed: ${message}`);
  }

  logAdminAction(`${sportCode}_create_round`, auth.user.id, round.id, "ok", `assigned=${assignResult.assigned} eligibilityErrors=${eligibilitySummary.errors.length}`);
  return apiOk({ roundId: round.id, assigned: assignResult.assigned, playerEligibility: eligibilitySummary }, 201);
}
