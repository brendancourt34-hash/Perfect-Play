import { getSportConfig } from "@/lib/sports/config";
import { getSportByCode } from "@/lib/data/sports";
import { createEntry, getUserSelectionsForCompetition, listUserEntriesForCompetition, type EntrySelectionInput } from "@/lib/data/entries";
import { getCompetitionForRound } from "@/lib/data/competitions";
import { getMaxEntriesPerRound } from "@/lib/data/platform-settings";
import { getRequestUser } from "@/lib/auth/require";
import { apiError, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

interface CreateEntryBody {
  selections?: { gameId: number; playerIds: number[] }[];
}

/**
 * The authenticated user's own entries in this one round, plus the max-entries-per-round
 * cap — powers the "Your entries X/10" display and the per-entry progress list. No
 * competition exists yet (nobody has entered) simply means an empty list, not an error.
 *
 * Also returns `sharedSelections`: the user's existing selection set for this
 * competition if they already have one (every one of their entries here holds an
 * identical copy — see purchaseEntryPackage's one-shared-selection-set model), or null
 * if they have none yet. This is what lets "buy more entries" skip the picking screen
 * entirely and show the existing picks read-only instead of asking the customer to
 * re-pick — the customer only ever completes the player-selection process once per
 * sport/round.
 */
export async function GET(request: Request, { params }: { params: Promise<{ sport: string; roundId: string }> }) {
  const { sport: sportSlug, roundId: roundIdParam } = await params;
  const sport = getSportConfig(sportSlug);
  if (!sport) return apiNotFound("Sport");

  const roundId = Number(roundIdParam);
  if (!Number.isInteger(roundId)) return apiNotFound("Round");

  const user = await getRequestUser(request);
  if (!user) return apiUnauthorized();

  const sportResult = await getSportByCode(sport.code);
  if (sportResult.status === "unavailable") return apiUnavailable();
  if (!sportResult.data) return apiError(422, `${sport.name} is not set up yet.`);

  const maxEntriesResult = await getMaxEntriesPerRound();
  if (maxEntriesResult.status === "unavailable") return apiUnavailable();

  const competitionResult = await getCompetitionForRound(sportResult.data.id, roundId);
  if (competitionResult.status === "unavailable") return apiUnavailable();
  if (!competitionResult.data) return apiOk({ entries: [], maxEntries: maxEntriesResult.data, sharedSelections: null });

  const [entriesResult, sharedSelectionsResult] = await Promise.all([
    listUserEntriesForCompetition(user.id, competitionResult.data.id),
    getUserSelectionsForCompetition(user.id, competitionResult.data.id),
  ]);
  if (entriesResult.status === "unavailable") return apiUnavailable();
  if (sharedSelectionsResult.status === "unavailable") return apiUnavailable();

  return apiOk({ entries: entriesResult.data, maxEntries: maxEntriesResult.data, sharedSelections: sharedSelectionsResult.data });
}

/**
 * Creates a competition entry for the authenticated user. Every actually-sensitive check
 * (competition open/closed, player eligibility, duplicate entry, cross-sport contamination)
 * happens inside createEntry (src/lib/data/entries.ts) — this route only resolves identity
 * and translates the result into an HTTP response. The mobile client never supplies its
 * own userId, price, or eligibility — all of that is server-authoritative.
 */
export async function POST(request: Request, { params }: { params: Promise<{ sport: string; roundId: string }> }) {
  const { sport: sportSlug, roundId: roundIdParam } = await params;
  const sport = getSportConfig(sportSlug);
  if (!sport) return apiNotFound("Sport");

  const roundId = Number(roundIdParam);
  if (!Number.isInteger(roundId)) return apiNotFound("Round");

  const user = await getRequestUser(request);
  if (!user) return apiUnauthorized();

  let body: CreateEntryBody;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Invalid request body.");
  }
  if (!body.selections || body.selections.length === 0) return apiError(400, "At least one selection is required.");

  const sportResult = await getSportByCode(sport.code);
  if (sportResult.status === "unavailable") return apiUnavailable();
  if (!sportResult.data) return apiError(422, `${sport.name} is not set up yet.`);

  const selections: EntrySelectionInput[] = body.selections.map((s) => ({
    gameId: Number(s.gameId),
    playerIds: (s.playerIds ?? []).map(Number),
  }));

  const result = await createEntry({
    sportId: sportResult.data.id,
    sportCode: sport.code,
    competitionName: `Perfect Play ${sport.name}`,
    roundId,
    userEmail: user.email,
    userName: user.name ?? user.email,
    selections,
  });

  if (result.status === "ok") return apiOk({ entryId: result.entryId }, 201);
  if (result.status === "invalid") return apiError(422, "Entry could not be created.", result.errors);
  return apiUnavailable();
}
