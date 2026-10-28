import { requireAdmin } from "@/lib/auth/require";
import { voidPlayerSelection } from "@/lib/data/void";
import { logAdminAction } from "@/lib/admin/audit-log";
import { apiError, apiForbidden, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";

/**
 * Admin resolution for one scratched/ruled-out player in one entry's one selection — the
 * game itself still goes ahead. Never invents correct/incorrect for a player who didn't
 * play; see src/lib/data/void.ts.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  let body: { entrySelectionId?: number; side?: "player1" | "player2"; reason?: string };
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Malformed request body.");
  }
  if (!body.entrySelectionId || !body.side || !body.reason) return apiError(400, "entrySelectionId, side, and reason are required.");
  if (body.side !== "player1" && body.side !== "player2") return apiError(400, 'side must be "player1" or "player2".');

  const result = await voidPlayerSelection(body.entrySelectionId, body.side, body.reason);
  if (result.status === "unavailable") return apiUnavailable();

  logAdminAction("void_selection", auth.user.id, body.entrySelectionId, "ok", `side=${body.side} voided=${result.data.voided} reason=${body.reason}`);
  return apiOk(result.data);
}
