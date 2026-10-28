import { getRequestUser } from "@/lib/auth/require";
import { listEntryGroupsForUser, getEntryWithResult } from "@/lib/data/entries";
import { apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

/**
 * The authenticated user's entries, GROUPED by competition/shared-selection-set — the
 * exact same grouping the web My Entries page already uses (listEntryGroupsForUser, see
 * src/app/my-entries/page.tsx), exposed as JSON for the mobile app. No second grouping
 * algorithm: this route is a thin API wrapper around that one function, plus the same
 * "read the shared picks off the FIRST entry in the group" step the web page already
 * does (getEntryWithResult — every entry in a group holds an identical canonical
 * selection set, see purchaseEntryPackage's guarantee), so the picks are shown once per
 * group, never once per entry.
 */
export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return apiUnauthorized();

  const groupsResult = await listEntryGroupsForUser(user.id);
  if (groupsResult.status === "unavailable") return apiUnavailable();

  const groups = await Promise.all(
    groupsResult.data.map(async (group) => {
      const detailResult = await getEntryWithResult(group.entryIds[0]);
      const detail = detailResult.status === "ok" ? detailResult.data : null;
      return {
        competitionId: group.competitionId,
        sportCode: group.sportCode,
        roundId: group.roundId,
        roundName: group.roundName,
        roundNumber: group.roundNumber,
        entryIds: group.entryIds,
        result: group.result,
        enteredAt: group.enteredAt,
        totalPrizeAllocationCents: group.totalPrizeAllocationCents,
        competitionWinnerCount: group.competitionWinnerCount,
        statField: detail?.statField ?? null,
        selections:
          detail?.selections.map((s) => ({
            gameId: s.gameId,
            homeTeamName: s.homeTeamName,
            awayTeamName: s.awayTeamName,
            gameResult: s.gameResult,
            playerName: s.selections[0]?.name ?? null,
            statCount: s.selections[0]?.statCount ?? null,
            pickResult: s.selections[0]?.result ?? "pending",
          })) ?? [],
      };
    }),
  );

  return apiOk({ groups });
}
