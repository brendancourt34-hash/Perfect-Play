"use server";

import { getSportConfig } from "@/lib/sports/config";
import { getSportByCode } from "@/lib/data/sports";
import { createEntry, type EntrySelectionInput } from "@/lib/data/entries";

export interface SubmitEntryInput {
  sportSlug: string;
  roundId: number;
  userName: string;
  userEmail: string;
  selections: EntrySelectionInput[];
}

export type SubmitEntryResult =
  | { status: "ok"; entryId: number }
  | { status: "invalid"; errors: string[] }
  | { status: "unavailable"; message: string };

/**
 * Server action backing the selection UI. Creates a pending (unpaid) entry — no
 * payment processing happens here, that's a later stage.
 */
export async function submitEntry(input: SubmitEntryInput): Promise<SubmitEntryResult> {
  const sport = getSportConfig(input.sportSlug);
  if (!sport) return { status: "invalid", errors: ["Unknown sport."] };

  if (!input.userName.trim() || !input.userEmail.trim()) {
    return { status: "invalid", errors: ["Name and email are required to enter."] };
  }

  const sportResult = await getSportByCode(sport.code);
  if (sportResult.status === "unavailable") return { status: "unavailable", message: sportResult.message };
  if (!sportResult.data) return { status: "invalid", errors: [`${sport.name} is not set up yet.`] };

  return createEntry({
    sportId: sportResult.data.id,
    sportCode: sport.code,
    competitionName: `Perfect Play ${sport.name}`,
    roundId: input.roundId,
    userEmail: input.userEmail.trim(),
    userName: input.userName.trim(),
    selections: input.selections,
  });
}
