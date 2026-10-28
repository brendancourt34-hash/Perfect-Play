import { getSportConfig } from "@/lib/sports/config";
import { getSportByCode } from "@/lib/data/sports";
import { purchaseEntryPackage } from "@/lib/data/entry-packages";
import type { EntrySelectionInput } from "@/lib/data/entries";
import { getRequestUser } from "@/lib/auth/require";
import { apiError, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

interface EnterPackageBody {
  packageId?: number;
  /**
   * ONE shared selection set — the customer picks the perfect round exactly once; every
   * entry the package buys gets an identical copy (see purchaseEntryPackage). If the
   * customer already holds an entry in this competition, the server ignores this
   * entirely and reuses their existing selections instead — ignored, not merely unused,
   * so a modified client can't submit a different set to create divergent entries.
   */
  selections?: { gameId: number; playerIds: number[] }[];
  /**
   * A key the client generates once per purchase attempt and resends unchanged on any
   * retry of that same attempt (double-tap, network retry) — never regenerated for a
   * genuinely new purchase decision. Namespaced with the caller's own userId before
   * being stored (see below), so two different users can never collide even by
   * coincidence, whatever entropy source the client used.
   */
  idempotencyKey?: string;
}

/**
 * Purchases an entry package (1/5/10 entries) for the authenticated user in one round.
 * Every sensitive decision — package validity, round-open state, the max-entries-per-round
 * cap, the wallet debit, and creating each identical entry from the one shared selection
 * set — happens inside purchaseEntryPackage (src/lib/data/entry-packages.ts). The client
 * never supplies price; only packageId (server looks up the real price) and the one
 * selection set (itself only used on a customer's first purchase in this competition).
 */
export async function POST(request: Request, { params }: { params: Promise<{ sport: string; roundId: string }> }) {
  const { sport: sportSlug, roundId: roundIdParam } = await params;
  const sport = getSportConfig(sportSlug);
  if (!sport) return apiNotFound("Sport");

  const roundId = Number(roundIdParam);
  if (!Number.isInteger(roundId)) return apiNotFound("Round");

  const user = await getRequestUser(request);
  if (!user) return apiUnauthorized();

  let body: EnterPackageBody;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Invalid request body.");
  }
  if (typeof body.packageId !== "number" || !Number.isInteger(body.packageId)) {
    return apiError(400, "packageId is required.");
  }
  if (!Array.isArray(body.selections) || body.selections.length === 0) {
    return apiError(400, "selections must be a non-empty array — one player pick per game, made exactly once.");
  }
  if (typeof body.idempotencyKey !== "string" || !body.idempotencyKey.trim()) {
    return apiError(400, "idempotencyKey is required — generate one per purchase attempt and resend it unchanged on any retry.");
  }

  const sportResult = await getSportByCode(sport.code);
  if (sportResult.status === "unavailable") return apiUnavailable();
  if (!sportResult.data) return apiError(422, `${sport.name} is not set up yet.`);

  const selections: EntrySelectionInput[] = body.selections.map((s) => ({ gameId: Number(s.gameId), playerIds: (s.playerIds ?? []).map(Number) }));

  const result = await purchaseEntryPackage({
    sportId: sportResult.data.id,
    sportCode: sport.code,
    competitionName: `Perfect Play ${sport.name}`,
    roundId,
    userId: user.id,
    packageId: body.packageId,
    selections,
    // Namespaced with the real authenticated userId (never a client-supplied one) —
    // this is what makes cross-user key collision structurally impossible regardless of
    // the client's own entropy source.
    idempotencyKey: `pkg:${user.id}:${body.idempotencyKey.trim()}`,
  });

  if (result.status === "ok") {
    return apiOk({ entryIds: result.entryIds, amountPaidCents: result.amountPaidCents, entryCount: result.entryCount, newBalanceCents: result.newBalanceCents }, 201);
  }
  if (result.status === "invalid") return apiError(422, "This entry package could not be purchased.", result.errors);
  if (result.status === "insufficient_funds") {
    return apiError(422, `Insufficient Perfect Play Balance — you have $${(result.balanceCents / 100).toFixed(2)}, this package costs $${(result.requiredCents / 100).toFixed(2)}.`);
  }
  return apiUnavailable();
}
