import { DevPaymentProvider } from "./providers/dev-payment-provider";
import { getPaymentConfig } from "./config";
import type { PaymentProvider } from "./types";

export class PaymentsMisconfiguredError extends Error {
  constructor(reason: string) {
    super(`Payments are misconfigured: ${reason}`);
    this.name = "PaymentsMisconfiguredError";
  }
}

/**
 * The single place any code asks "who do I charge through?" — Phase 20.
 *
 * PAYMENTS_ENABLED defaults false (see ./config.ts) and gates only a REAL provider ever
 * being called. It does NOT gate the dev/test simulator: the existing buy-in → picks →
 * review → confirmation flow (Phase 16-19) depends on always being able to exercise that
 * flow end-to-end, and Perfect Play's legal classification for real money is still pending —
 * so today, regardless of this flag, the only provider that can ever be returned is
 * DevPaymentProvider, which is structurally incapable of reporting "paid".
 *
 * If PAYMENTS_ENABLED is ever set true without a real provider actually implemented and
 * selected, this throws rather than either (a) silently using the dev simulator as if it
 * were real, or (b) silently doing nothing — a misconfiguration should be loud, not a
 * hidden path to a fake "paid" entry.
 */
export function getPaymentProvider(): PaymentProvider {
  const config = getPaymentConfig();

  if (config.paymentsEnabled) {
    if (config.provider === "none") {
      throw new PaymentsMisconfiguredError(
        "PAYMENTS_ENABLED=true but PAYMENT_PROVIDER=none — no real provider has been chosen/implemented yet. Refusing to proceed rather than silently falling back to the dev simulator.",
      );
    }
    // No real provider exists in this codebase yet (Perfect Play's legal classification is
    // pending — see docs/phase20-payment-infrastructure.md). When one is chosen and
    // implemented under providers/, add it here, e.g.:
    //   if (config.provider === "stripe") return new StripeProvider();
    throw new PaymentsMisconfiguredError(`PAYMENT_PROVIDER="${config.provider}" is not yet implemented.`);
  }

  return new DevPaymentProvider();
}
