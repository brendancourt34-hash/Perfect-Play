import { apiOk, apiUnavailable } from "@/lib/api/response";
import { listActiveEntryPackages } from "@/lib/data/entry-packages";

/** The purchasable entry packages (1/5/10-entry bundles) — same set across every sport/round, admin-configurable. Public: no price/eligibility decision is made here. */
export async function GET() {
  const result = await listActiveEntryPackages();
  if (result.status === "unavailable") return apiUnavailable();
  return apiOk({ packages: result.data });
}
