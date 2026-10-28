import { apiNotFound, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { getRequestUser } from "@/lib/auth/require";
import { getTransactionForUser } from "@/lib/data/payment-transactions";

/**
 * A single transaction's detail — ownership-checked at the query itself
 * (getTransactionForUser), so a transaction belonging to someone else 404s exactly like a
 * nonexistent one, rather than a 403 that would confirm the id exists.
 */
export async function GET(request: Request, { params }: { params: Promise<{ transactionId: string }> }) {
  const { transactionId: transactionIdParam } = await params;
  const transactionId = Number(transactionIdParam);
  if (!Number.isInteger(transactionId)) return apiNotFound("Transaction");

  const user = await getRequestUser(request);
  if (!user) return apiUnauthorized();

  const result = await getTransactionForUser(transactionId, user.id);
  if (result.status === "unavailable") return apiUnavailable();
  if (!result.data) return apiNotFound("Transaction");

  const t = result.data;
  return apiOk({
    transaction: {
      transactionId: t.id,
      competitionId: t.competitionId,
      competitionEntryId: t.competitionEntryId,
      provider: t.provider,
      providerTransactionId: t.providerTransactionId,
      amountCents: t.amountCents,
      currency: t.currency,
      status: t.status,
      transactionType: t.transactionType,
      failureCode: t.failureCode,
      failureMessage: t.failureMessage,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      completedAt: t.completedAt,
    },
  });
}
