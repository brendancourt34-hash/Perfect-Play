import { apiNotFound, apiOk, apiUnavailable } from "@/lib/api/response";
import { getCurrentPublishedTerms } from "@/lib/data/terms";

/** The current published Terms & Conditions — public, no auth required (shown during registration before an account exists). */
export async function GET() {
  const result = await getCurrentPublishedTerms();
  if (result.status === "unavailable") return apiUnavailable();
  if (!result.data) return apiNotFound("Terms & Conditions");

  const { id, versionNumber, effectiveDate, publishedAt, content } = result.data;
  return apiOk({ terms: { id, versionNumber, effectiveDate, publishedAt, content } });
}
