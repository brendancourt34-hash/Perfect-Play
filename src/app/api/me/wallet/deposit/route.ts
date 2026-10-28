import { apiError, apiOk, apiUnauthorized, apiUnavailable } from "@/lib/api/response";
import { getRequestUser } from "@/lib/auth/require";
import { depositToWallet } from "@/lib/data/wallet";

/**
 * Adds funds to the signed-in user's Perfect Play Balance via the existing (dev-only)
 * payment provider abstraction — real money remains disabled pending legal review (Phase
 * 20). `amountCents` is read from the body so the client can offer preset amounts
 * ($5/$10/$20/$50) or a custom amount; the server only validates it's a sane positive
 * integer, it never trusts a price computed client-side beyond that.
 */
export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return apiUnauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Invalid request body.");
  }

  const amountCents = (body as { amountCents?: unknown })?.amountCents;
  if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents < 100 || amountCents > 100_000) {
    return apiError(422, "Deposit amount must be between $1 and $1,000.");
  }

  const result = await depositToWallet(user.id, amountCents);
  if (result.status === "unavailable") return apiUnavailable();
  if (result.status === "failed") return apiError(422, result.message);
  if (result.status === "pending") {
    // Honest, not an error: the deposit attempt was recorded, but no payment has been
    // confirmed yet, so the balance genuinely has not changed — see depositToWallet's doc
    // comment for why crediting here would be premature. confirmed=false is what the
    // client uses to show "awaiting confirmation" instead of claiming success.
    return apiOk({ confirmed: false, message: result.message });
  }

  return apiOk({ confirmed: true, providerStatus: result.providerStatus, newBalanceCents: result.newBalanceCents });
}
