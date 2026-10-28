import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { apiForbidden, apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/require";
import { getBalance, listWalletTransactions } from "@/lib/data/wallet";

/** Admin visibility into any user's Perfect Play Balance and full ledger history. */
export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await requireAdmin(request);
  if (auth.status === "unauthenticated") return apiUnauthorized();
  if (auth.status === "forbidden") return apiForbidden();
  if (auth.status === "unavailable") return apiUnavailable();

  const { userId: userIdParam } = await params;
  const userId = Number(userIdParam);
  if (!Number.isInteger(userId)) return apiNotFound("User");

  const userRows = await getDb().select({ id: schema.users.id, email: schema.users.email, name: schema.users.name }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!userRows[0]) return apiNotFound("User");

  const [balanceResult, transactionsResult] = await Promise.all([getBalance(userId), listWalletTransactions(userId)]);
  if (balanceResult.status === "unavailable" || transactionsResult.status === "unavailable") return apiUnavailable();

  return apiOk({ user: userRows[0], balanceCents: balanceResult.data, transactions: transactionsResult.data });
}
