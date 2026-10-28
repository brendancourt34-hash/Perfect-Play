import { requireAdmin } from "@/lib/auth/require";
import { voidGame } from "@/lib/data/void";
import { logAdminAction } from "@/lib/admin/audit-log";
import { apiError, apiForbidden, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

/**
 * Admin resolution for a real-world cancelled game (Phase 22 §20/21): marks the game
 * cancelled and voids every pending selection referencing it, across every entry. Never
 * invents correct/incorrect — see src/lib/data/void.ts and src/lib/perfect2/settle.ts.
 * Not sport-specific despite living under /nba — any sport's game can be voided this way.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  let body: { gameId?: number; reason?: string };
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Malformed request body.");
  }
  if (!body.gameId || !body.reason) return apiError(400, "gameId and reason are required.");

  const result = await voidGame(body.gameId, body.reason);
  if (result.status === "unavailable") return apiUnavailable();

  logAdminAction("void_game", auth.user.id, body.gameId, "ok", `selectionsVoided=${result.data.selectionsVoided} reason=${body.reason}`);
  return apiOk(result.data);
}
