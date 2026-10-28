import { apiError, apiForbidden, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/require";
import { runSimulation, validateSimulationInput, type SimulationInput } from "@/lib/perfect2/simulation";

/**
 * Internal/admin-only Perfect Rate simulation — Feature 7. No real customers, no real
 * money, no live Prize Pool: every input here is an explicit modeling assumption supplied
 * by the admin caller. This is product/statistics modeling only — it never returns
 * betting advice or a recommended pick.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Invalid JSON body.");
  }
  const b = body as Partial<SimulationInput> & { favoriteWeightsPct?: unknown; rankSuccessProbabilities?: unknown };

  const input: SimulationInput = {
    gamesCount: Number(b.gamesCount),
    customerCount: Number(b.customerCount),
    numberOfSimulations: Number(b.numberOfSimulations),
    favoriteWeightsPct: Array.isArray(b.favoriteWeightsPct) ? b.favoriteWeightsPct.map(Number) : [],
    rankSuccessProbabilities: Array.isArray(b.rankSuccessProbabilities) ? b.rankSuccessProbabilities.map(Number) : [],
    assumedPrizePoolCents: Number(b.assumedPrizePoolCents),
    // Deterministic-but-caller-controllable: an admin re-running the exact same inputs with
    // the same seed gets the exact same reproducible result; omitting it still produces a
    // valid (just not manually reproducible-by-typing) run.
    seed: typeof b.seed === "string" && b.seed.length > 0 ? b.seed : `sim-${Date.now()}`,
  };

  // Hard caps — this is a modeling tool, not a load-generation endpoint: an admin
  // requesting an absurd customerCount/numberOfSimulations must not be able to pin the
  // server for minutes on a single request.
  if (input.customerCount > 200_000) return apiError(400, "customerCount cannot exceed 200,000 for a single simulation run.");
  if (input.numberOfSimulations > 500) return apiError(400, "numberOfSimulations cannot exceed 500 for a single simulation run.");

  const errors = validateSimulationInput(input);
  if (errors.length > 0) return apiError(400, "Invalid simulation input.", errors);

  const result = runSimulation(input);
  return apiOk({ result });
}
