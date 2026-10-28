/**
 * Server-side payment configuration — Phase 20. This is the legal/compliance gate: real
 * money stays off unless BOTH of these are explicitly set in server environment
 * variables. Never read from a client request, never influenced by anything the mobile
 * app or a browser sends — there is no code path anywhere that lets a request body,
 * query string, or header change these values.
 *
 * Perfect Play has not been legally cleared to operate for real money (a specialist
 * Australian gambling lawyer's classification is pending). Until that's resolved and a
 * real provider is chosen, PAYMENT_PROVIDER can only ever be "none" — see
 * getPaymentProvider() (./registry.ts), which throws rather than silently faking a real
 * charge if PAYMENTS_ENABLED is ever set true without a real provider actually
 * implemented.
 */
export type PaymentProviderName = "none" | "dev";

export interface PaymentConfig {
  /** Defaults false. Gates whether a REAL provider may ever be called — the dev/test simulator is unaffected by this flag either way. */
  paymentsEnabled: boolean;
  /** Defaults "none". Will grow to include a real provider identifier once one is chosen and implemented. */
  provider: PaymentProviderName;
}

export function getPaymentConfig(): PaymentConfig {
  const paymentsEnabled = process.env.PAYMENTS_ENABLED === "true";
  const rawProvider = process.env.PAYMENT_PROVIDER;
  const provider: PaymentProviderName = rawProvider === "dev" ? "dev" : "none";
  return { paymentsEnabled, provider };
}
