import { SPORTS } from "@/lib/sports/config";
import { apiOk } from "@/lib/api/response";

/** Static competition config the mobile app's sport picker needs — no live data required. */
export async function GET() {
  return apiOk({
    sports: Object.values(SPORTS).map((s) => ({
      code: s.code,
      slug: s.slug,
      name: s.name,
      fullName: s.fullName,
      ruleSummary: s.ruleSummary,
    })),
  });
}
