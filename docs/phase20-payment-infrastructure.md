# Perfect Play — Phase 20: Production Payment Infrastructure (Legal Gate)

**Status:** Implemented and verified. **Real money is permanently disabled** pending
Australian gambling-law legal review — this phase is ready for a real provider to be
plugged in once that review clears, but is **not** cleared for real-money operation itself.
**Date:** 2026-09-05

---

## 0. The legal gate — read this first

Perfect Play has not been classified by Australian gambling counsel. Until that review
concludes:

- `PAYMENTS_ENABLED` must stay `false` (the default).
- `PAYMENT_PROVIDER` must stay `none` (the default).
- No live payment SDK (Stripe, Square, PayPal, or any other) is installed or imported
  anywhere in this codebase.
- No production credentials, API keys, or webhook secrets exist anywhere in this repo.
- The only `PaymentProvider` implementation that exists is `DevPaymentProvider`, which is
  structurally incapable of reporting a real "paid" status, refunding anything, or
  verifying a real webhook.

This document describes infrastructure that is **ready for a provider**, not infrastructure
that **has** one. See §9 for what actually changes when the legal review clears.

---

## 1. Architecture overview

```
                       ┌────────────────────────┐
   createEntry() ─────▶│  chargeForEntry()        │──▶ payment_transactions (row)
   payment pre-flight ─▶│  (src/lib/data/          │
   route              │   payment-transactions.ts)│
                       └───────────┬──────────────┘
                                   │
                                   ▼
                       ┌────────────────────────┐
                       │  getPaymentProvider()    │  ← src/lib/payments/registry.ts
                       │  (PAYMENTS_ENABLED +     │     gates whether a REAL provider
                       │   PAYMENT_PROVIDER gate) │     may ever be reached
                       └───────────┬──────────────┘
                                   │
                                   ▼
                       ┌────────────────────────┐
                       │  PaymentProvider          │  ← src/lib/payments/types.ts
                       │  interface                │     (createPayment / getPayment /
                       │                            │      refundPayment /
                       │                            │      verifyWebhookSignature /
                       │                            │      parseWebhookEvent)
                       └───────────┬──────────────┘
                                   │
                                   ▼
                       ┌────────────────────────┐
                       │  DevPaymentProvider       │  ← the ONLY implementation that
                       │  (dev/test-only)          │     exists today — never reports
                       │                            │     "paid", never fabricates
                       │                            │     success
                       └────────────────────────┘
```

Every payment-adjacent operation funnels through the same `PaymentProvider` interface, the
same `payment_transactions` table, and the same state machine — there is exactly one path
for money to move (or, today, to be simulated), not one path for entries and a different
one for refunds.

## 2. Domain model — `payment_transactions`

Added this phase (`scripts/migrate-add-payment-transactions.ts`), additive only, no
existing table altered in a breaking way:

| Column | Notes |
| --- | --- |
| `user_id` | who this transaction belongs to |
| `competition_entry_id` | nullable — set once the entry it paid for actually exists (`linkTransactionToEntry`) |
| `competition_id` | which competition this charge/refund is for |
| `provider` | e.g. `"dev-test-only"` today |
| `provider_transaction_id` | opaque provider reference; always `null` today (no real provider) |
| `idempotency_key` | **unique**, server-derived, never client-supplied |
| `amount_cents`, `currency` | always server-derived from `competitions.entryFeeCents`, never from a request |
| `status` | `pending \| paid \| failed \| cancelled \| refunded` |
| `transaction_type` | `payment \| refund` |
| `failure_code`, `failure_message` | populated on failure, never fabricated |
| `metadata` | small non-sensitive JSON only — never secrets |

This is a distinct concept from `competition_entries.paymentStatus`/`paidAmountCents`
(Phase 16): the entry columns are a **denormalized snapshot** of the entry's own payment
outcome for fast reads; `payment_transactions` is the **durable, append-mostly ledger** of
every attempt (an entry has exactly one successful payment transaction, but can have
multiple failed/retried attempts, plus zero or more refund transactions). Nothing in this
phase changed the meaning of the existing entry columns.

## 3. Idempotency

`chargeForEntry(userId, competitionId, amountCents)`
(`src/lib/data/payment-transactions.ts`) is the only place any code charges a user for an
entry. Idempotency key is always `payment:{userId}:{competitionId}` — one payment lifecycle
per user per competition, derived entirely server-side.

- An existing `pending`/`paid` row for that key is returned as-is — a genuine replay of an
  attempt already in flight or already settled never calls the provider again.
- An existing `failed`/`cancelled` row is a legitimate retry: the **same row** is updated
  in place (same idempotency key), never a new row.
- Two concurrent first-attempts race on the database's `UNIQUE` index on `idempotency_key`
  (`onConflictDoNothing`); the losing insert is a no-op and re-reads the winner's row
  instead of erroring or creating a duplicate charge.

Refunds (`refundTransaction`, §6) use the same pattern with key `refund:{original key}`, so
retrying a refund of the same payment can never double-refund.

## 4. State machine

`src/lib/payments/state-machine.ts` is the single source of truth for legal transitions,
used by every write path (`chargeForEntry`, `refundTransaction`, the webhook handler):

```
pending   → pending | paid | failed | cancelled
paid      → paid | refunded
failed    → failed        (terminal)
cancelled → cancelled      (terminal)
refunded  → refunded       (terminal)
```

`assertTransition(from, to)` throws `InvalidPaymentTransitionError` for anything outside
this table — e.g. a webhook event can never move an already-refunded transaction back to
"paid". 15 unit tests (`state-machine.test.ts`) cover every legal and illegal transition
named above.

## 5. Feature flags & environment

`src/lib/payments/config.ts` — server-only, read from `process.env` only, never from a
request:

| Var | Default | Meaning |
| --- | --- | --- |
| `PAYMENTS_ENABLED` | `false` | Gates whether a **real** provider may ever be called. Does **not** gate the dev/test simulator. |
| `PAYMENT_PROVIDER` | `none` | Which real provider to use once one is implemented. `"none"` and unrecognized values both resolve to `"none"`. |

`getPaymentProvider()` (`src/lib/payments/registry.ts`):
- `PAYMENTS_ENABLED=false` → always returns `DevPaymentProvider`, regardless of
  `PAYMENT_PROVIDER` — the existing buy-in → picks → review → confirmation flow keeps
  working end-to-end without moving money.
- `PAYMENTS_ENABLED=true` with `PAYMENT_PROVIDER=none` → throws `PaymentsMisconfiguredError`.
- `PAYMENTS_ENABLED=true` with any provider name → throws `PaymentsMisconfiguredError`,
  because no real provider is implemented in this codebase yet.

A misconfiguration is always loud (a thrown error surfaced as a 503 to the caller), never a
silent fallback to fake success or silent no-op.

## 6. Refunds (architecture only — no button, no endpoint)

`src/lib/payments/refunds.ts` — `refundTransaction(originalTransactionId, amountCents,
reason?)`. Deliberately **not** wired to any customer-facing button or API route this
phase, and does not require an admin UI either — it exists so a future authorized workflow
has a correct primitive to call.

- Only a `payment`-type transaction currently `paid` is refundable (`isRefundable`) —
  never a pending/failed/cancelled charge, never a refund row itself.
- Refund amount must be `> 0` and `<= original.amountCents`.
- Every refund attempt is its own `payment_transactions` row
  (`transaction_type: "refund"`), linked back via `metadata.originalTransactionId` — the
  original payment row is never deleted or overwritten.
- The **original** payment only ever moves to `refunded` once the provider actually
  confirms the refund (`result.status === "refunded"`) — a failed or still-pending refund
  attempt leaves the original charge exactly as it was.
- `DevPaymentProvider.refundPayment` always returns `failed` / `no_provider_connected`, so
  every refund attempt today is recorded as failed — accurately, since nothing was ever
  really charged to refund.

## 7. Reconciliation (read-only)

`src/lib/payments/reconciliation.ts` compares Perfect Play's own record of a payment against
the provider's record of it, and **never writes anything back** — any correction is a
separate, explicitly-authorized action for a human, never something reconciliation does
itself. Five named outcomes:

| Outcome | Meaning |
| --- | --- |
| `MATCHED` | internal and provider status agree |
| `NO_PROVIDER_RECORD` | no `provider_transaction_id` recorded, or the provider has no record of it — the expected state for every transaction today |
| `PROVIDER_PAID_INTERNAL_PENDING` | provider says paid, we still show pending — likely a missed/delayed webhook |
| `PROVIDER_FAILED_INTERNAL_PENDING` | provider says failed, we still show pending |
| `STATUS_MISMATCH` | any other disagreement (e.g. internal paid, provider refunded) |

`reconcilePendingTransactions()` sweeps every currently-`pending` transaction; terminal
transactions are immutable once settled and are not repeatedly re-checked. Because no real
provider is connected, every finding produced today is `NO_PROVIDER_RECORD` by design.

## 8. Webhook endpoint — fails safe

`POST /api/payments/webhook/[provider]` (`src/app/api/payments/webhook/[provider]/route.ts`)
is provider-neutral and has **no user-session auth** — a webhook comes from the payment
provider, not a logged-in user, so the *only* thing that can ever authorize a write through
this route is a verified provider signature:

1. The URL's `[provider]` segment must match the server's actually-configured provider (or
   the request 404s) — this alone isn't authentication, it just avoids leaking
   configuration details through differentiated error responses.
2. `provider.verifyWebhookSignature(rawBody, signatureHeader)` must return `valid: true` or
   the request is rejected with 401.
3. Only after verification does `parseWebhookEvent` run, and only a successfully parsed
   event with a known `providerTransactionId` is applied — via
   `applyWebhookEventToTransaction`, which itself calls `assertTransition` (§4), so an
   illegal transition is rejected rather than silently applied.

`DevPaymentProvider.verifyWebhookSignature` always returns `{ valid: false }` — there is no
real signing secret because there is no real provider. **Every single request to this
endpoint is rejected today, including a genuine-looking one.** This is the required
fail-safe behavior, not a bug: nothing arriving here can be trusted until a real provider
and a real signing secret exist.

## 9. Customer payment history

- `GET /api/me/payments` — the signed-in user's own transactions, newest first. No other
  user's rows are ever reachable through this route.
- `GET /api/payments/[transactionId]` — a single transaction's detail, ownership-checked
  at the query itself (`getTransactionForUser`), so a transaction belonging to someone
  else 404s exactly like a nonexistent one (never a 403 that would confirm the id exists).

## 10. Admin monitoring (extended, still read-only)

- Dashboard (`GET /api/admin/dashboard`, `src/lib/data/admin.ts`) now reports a
  `transactions` block (`pending/paid/failed/cancelled/refunded/refundAttempts`) alongside
  the existing entry-level `payments` block — the two are related but not identical, since
  one entry can correspond to multiple transaction attempts.
- Entry detail (`GET /api/admin/entries/[entryId]`) now includes every
  `payment_transactions` row linked to that entry (provider, provider reference, status,
  failure reason, timestamps).
- No manual "mark as paid" or any other override control exists anywhere in the admin UI —
  consistent with Phase 18/19's read-only admin principle, and doubly required here since
  fabricating a "paid" status would misrepresent whether money actually moved.

## 11. Security posture

- Amount and currency are **always** server-derived from `competitions.entryFeeCents` —
  never accepted from a request body on any payment-adjacent route.
- Idempotency keys are **always** server-derived (`payment:{userId}:{competitionId}`,
  `refund:{original key}`) — never accepted from a client, so a client cannot force a
  collision or a bypass.
- Every customer-facing payment route re-derives the requesting user from the session
  (`getRequestUser`) and checks ownership at the query layer, not just at the route layer.
- The webhook route has no session auth by design (§8) and relies entirely on provider
  signature verification, which today always fails closed.
- No live provider SDK, production credential, or webhook secret exists anywhere in this
  repository (verified by codebase grep — see the Phase 20 QA script and final report).

## 12. What changes when the legal review clears

None of this today. When Australian gambling counsel clears real-money operation and a
specific provider is chosen:

1. Implement a real `PaymentProvider` (e.g. `providers/stripe-provider.ts`) against the
   existing interface — no call site (`chargeForEntry`, `refundTransaction`, the webhook
   route) needs to change.
2. Add the real provider's case to `getPaymentProvider()`'s branch in `registry.ts`.
3. Set `PAYMENT_PROVIDER` to that provider's name and `PAYMENTS_ENABLED=true` in the
   server environment only.
4. Provision real webhook signing secrets and provider credentials through the
   environment — never hardcoded, never committed.

Until all four of those happen, Perfect Play remains exactly what it is today: a fully-formed
payment architecture with no live money behind it.
