# Perfect Play — Mobile App Architecture

**Perfect Play's primary customer-facing product is a native mobile application distributed
through the Apple App Store and Google Play. The existing Next.js application remains
valuable as the backend/platform and administrative foundation.**

**Status:** Architecture decided and the initial API boundary + Expo project scaffolded
this phase. No Champion Data connection, no payments, no push notifications, no store
submissions.
**Date:** 2026-09-04

---

## 1. Current architecture (what exists, audited before any change)

Everything built in Stages 1–8 and Phases 9–10 is **product-agnostic business logic** —
none of it assumes a browser is the client:

- **Database** (Neon Postgres via Drizzle): sports-data hierarchy (sports → seasons →
  rounds → games → teams → players → game_lineups → player_game_stats) and the
  competition model (competitions → competition_entries → entry_selections). 13 tables
  after this phase (added `sessions`), still 0 rows everywhere.
- **Settlement engine** (`src/lib/perfect2/`) — pure functions (`settleSelection`,
  `settleGameSelection`, `settleEntry`, `settleEntrySelections`, `determineWinners`). No
  I/O, no framework dependency. Directly reusable from any server context.
- **Competition lifecycle** (`src/lib/competitions/lifecycle.ts`) — pure state/timing
  decisions (`getEffectiveCompetitionState`, `canAcceptEntries`, `decideCloseAction`,
  `decideSettleAction`). Same story: no framework dependency.
- **Data access layer** (`src/lib/data/`) — all server-only, all behind `getDb()` (lazy
  Neon connection), all returning a `DataResult<T>` instead of throwing.
- **Sports-data abstraction** (`src/lib/sports-data/`) — provider interface, normalized
  types, idempotent sync, validation. Entirely provider-agnostic; still blocked on
  Champion Data, unaffected by this phase.
- **Web UI** (`src/app/`) — Next.js App Router pages and a couple of server actions
  (`src/app/[sport]/rounds/[roundId]/enter/actions.ts`). This is the *only* layer that was
  browser-specific, and it's exactly the layer a mobile app can't reuse — Next.js Server
  Actions are a framework-internal RPC mechanism (an encoded POST protocol tied to the
  Next.js client runtime), not a stable public API a separate React Native app can call.

**Conclusion of the audit: the backend was already architected correctly for this
pivot.** Every piece of business logic below the UI/server-action layer has zero
dependency on being rendered in a browser. The only genuinely new work required was (a) a
real HTTP API boundary wrapping the existing data-access functions, since Server Actions
can't serve that role, and (b) authentication that isn't tied to a browser session cookie
alone — everything else (competition rules, settlement, eligibility, validation) is reused
completely unchanged.

---

## 2. Mobile stack decision: React Native + Expo

No compelling reason surfaced during the audit to deviate from the brief's recommendation.
Specifically:

- **Single codebase for iOS + Android** — the brief's explicit goal, and Expo's core value
  proposition.
- **EAS Build** handles native compilation for both platforms without requiring a local
  Xcode/Android Studio toolchain for every build — relevant since this environment can't
  run a native iOS build itself.
- **Expo Router** gives file-based routing analogous to Next.js's App Router, which keeps
  the mental model consistent between the two codebases for whoever maintains both.
- **TypeScript-first**, matching the existing codebase's conventions exactly (strict mode,
  same linting philosophy).
- Mature ecosystem for the specific things Perfect Play needs later: `expo-secure-store`
  (session token storage), `expo-notifications` (push, future), and a clear, documented
  path to in-app purchases via `react-native-iap`/`expo-in-app-purchases` when payments
  are built.

**No native modules requiring ejection from Expo's managed workflow are anticipated** for
Perfect Play's feature set (a picks-and-results app, not something needing exotic hardware
access) — so the managed workflow (no need for bare/prebuild) is the right default.

---

## 3. What remains in Next.js

- **The database** — unchanged, remains the single source of truth, accessed only from
  server-side code (Next.js route handlers), never directly from any client.
- **All business logic** — settlement, lifecycle, validation, sports-data sync. Never
  duplicated into the mobile app (see §5 — critical rule).
- **The JSON API boundary** (new this phase, `src/app/api/`) — what the mobile app talks
  to.
- **The existing web UI** — kept as-is. It's a legitimate lightweight public
  website/fallback and, per the brief, a natural base for an eventual admin dashboard
  (competition management, sports-data status, settlement triggers) — none of that admin
  surface was built this phase (out of scope), but the pure functions it would call
  (`closeCompetition`, `settleCompetition`) already exist and are already framework-agnostic.
- **Authentication issuance** — registration/login/session verification lives entirely in
  Next.js (`src/lib/auth/`, `src/lib/data/auth.ts`), shared by both the web cookie flow and
  the mobile bearer-token flow (see §6).

---

## 4. What was created for mobile

- **`mobile/`** — an Expo (TypeScript) project at the repository root, scaffolded via
  `create-expo-app`. Bundle identifiers, app icon/splash, and screens are placeholders at
  this stage — see §7 and §11 for what's real vs. what's a documented next step.
- The mobile app is a **separate package** from the Next.js app (its own
  `package.json`/`node_modules`), consistent with how Expo and Next.js projects are
  normally combined — they don't share a build toolchain, only an API contract.

---

## 5. Critical rule: business logic stays server-side, never duplicated

The mobile app is a **thin client**. It never re-implements:

- Whether a competition currently accepts entries (`canAcceptEntries`)
- Whether a player is eligible for a given game
- Whether a selection pair is valid (duplicate players, wrong game, etc.)
- Settlement (correct/incorrect, perfect/not perfect)
- Winner determination
- Entry pricing or prize amounts
- Payment state

Every one of those is computed server-side and returned as data. The mobile app's job is
to *display* what the API says and *collect* what the user picks — nothing more. This is
exactly what the brief's "never trust the mobile client for..." list requires, and it's
enforced the same way it already was for the web app: `POST .../entries` re-validates
everything server-side regardless of what the client sends (see
`docs/phase9-10-competition-results.md` for the existing hardening — cross-sport guard,
eligibility, locking, duplicate-entry rejection — none of which changed this phase).

---

## 6. API boundary (new this phase)

REST-ish JSON routes under `src/app/api/`, each a thin wrapper around an existing
data-access function — no business logic lives in a route handler. Every response uses a
consistent envelope: `{ ok: true, data }` or `{ ok: false, message, errors? }`
(`src/lib/api/response.ts`).

| Route | Method | Auth | Wraps |
|---|---|---|---|
| `/api/sports` | GET | none | Static sport config |
| `/api/[sport]/rounds` | GET | none | `listRounds` (current/latest season) |
| `/api/[sport]/rounds/[roundId]` | GET | none | Round + games + eligible players (per game) + live competition state/price — one round-trip for the "pick your team" screen |
| `/api/[sport]/rounds/[roundId]/entries` | POST | **required** | `createEntry`, using the authenticated user's identity — not client-supplied |
| `/api/[sport]/rounds/[roundId]/results` | GET | none | `getCompetitionResultsSummary` |
| `/api/entries` | GET | **required** | `listEntriesForUser` (new this phase) — the authenticated user's own entries only |
| `/api/entries/[entryId]` | GET | **required**, ownership-checked | `getEntryWithResult` — 403 if the entry belongs to someone else |
| `/api/auth/register` | POST | none | `registerUser` |
| `/api/auth/login` | POST | none | `loginUser` |
| `/api/auth/logout` | POST | bearer token | `revokeSessionToken` |
| `/api/auth/me` | GET | **required** | Current user from session |

This is deliberately **not** an exhaustive REST surface — e.g. there's no
`PATCH /entries/:id` because no entry-editing feature exists anywhere in the app (by
design, see `docs/phase9-10-competition-results.md`), and no `GET /teams`/`GET /players`
standalone endpoints because the mobile picking screen only ever needs players *in the
context of a round's games*, which the round-detail endpoint already provides in one call.
Additional endpoints should be added the same way — thin wrappers around an existing (or
newly justified) data-access function — rather than speculatively building a generic CRUD
API.

---

## 7. Authentication architecture

**First-party email + password, no external provider, no invented credentials.**

- `src/lib/auth/password.ts` — Node's built-in `scrypt` (no new dependency), random
  16-byte salt per password, constant-time verification.
- `src/lib/auth/session.ts` — opaque 32-byte random bearer tokens. Only a SHA-256 hash of
  the token is ever stored (`sessions.tokenHash`) — a database read alone can never be
  replayed as a working session.
- `users.passwordHash` (nullable — a future external-provider-only account can exist
  without one) and a new `sessions` table (`userId`, `tokenHash`, `expiresAt`) are the only
  schema changes this phase.
- **Same identity, two transport mechanisms**: `src/lib/auth/require.ts`'s
  `getRequestUser()` checks, in order, an `Authorization: Bearer <token>` header (mobile's
  mechanism) then a `session` cookie (a future web mechanism) — both verified against the
  same `sessions` table. A token issued by `/api/auth/login` works identically regardless
  of which client asked for it.
- **Sessions expire after 30 days** (`SESSION_DURATION_MS`) and logout immediately deletes
  the row — there's no "soft revoke," a logged-out token stops working immediately.
- **Not built, and explicitly requiring a future decision**: password reset (needs a real
  email-sending provider — no credentials exist for one, so this is documented, not
  invented), and any social login (**"Sign in with Apple" is an Apple App Store
  requirement if any other third-party/social login is offered** — so if Google Sign-In is
  ever added, Apple Sign-In must be added alongside it, not instead of it). Neither was
  built this phase since both need real external credentials this project doesn't have.

### Authorization

Simple ownership checks, not roles (no admin-vs-user distinction exists yet):
`GET /api/entries/:id` returns 403 if the entry's `userId` doesn't match the authenticated
user. `POST .../entries` always creates the entry under the *authenticated* user, never a
client-supplied identity. A future admin surface would need an explicit
`users.isAdmin`/role concept — not built, since no admin UI exists yet to gate.

---

## 8. Payment considerations (not implemented — documented for a future decision)

Real, unresolved product/legal questions that must be answered **before** writing any
payment code, not engineering guesses:

- **Apple's In-App Purchase rule**: Apple requires IAP (Apple's own payment system, 15–30%
  commission) for **digital content/services consumed within the app**. Whether a paid
  entry into a skill-based prediction competition counts as "digital content" under
  Apple's guidelines, or falls under an exception (e.g. how real-money skill contests /
  fantasy sports apps like PrizePicks or Underdog Fantasy are categorized — they generally
  use external payment processing, not IAP, because they're structured as licensed
  contests rather than purchases of digital content) is a **legal/compliance
  classification question**, not something to assume either way in code.
- **Google Play** has a comparable (if slightly more flexible) Play Billing requirement
  with similar exceptions for real-money gaming/contest apps in specific categories.
- **If external payment processing is permitted** (the likely path, based on how
  comparable real-money contest apps operate), a standard processor (Stripe is the obvious
  candidate given it's already referenced elsewhere in this project's tooling) would
  collect the $5/$10 entry fee outside of Apple/Google's cut — but this still requires:
  age verification, real-money-gaming licensing research (which differs by Australian
  state/territory), and KYC/AML considerations once real prize money is involved.
- **What the schema is already ready for**: `competitions.entryFeeCents`,
  `competition_entries.paymentStatus` (`pending|paid|refunded`) and `paidAmountCents`
  already exist and are wired through the entry-creation flow as `pending`/`null` — adding
  real payment processing later is "flip `paymentStatus` to `paid` after a successful
  charge," not a schema or entry-flow redesign.

**No fake transactions, no fake payment confirmation UI, no IAP integration was added this
phase.** The mobile app's entry-confirmation screen (once built) must say as plainly as the
web app's already does: payment has not been processed yet.

---

## 9. Push notification considerations (not implemented — architecture-ready)

Natural future events to notify on, all already representable from existing data with no
new fields required: competition closing soon (`competitions.closesAt`), entry confirmed
(`competition_entries` insert), results available (`competitions.status = "settled"`),
entry became PERFECT/NOT PERFECT (`competition_entries.result` change). Building this
requires: `expo-notifications` in the mobile app, a device push token stored against the
user (a new `push_tokens` table — not created this phase, no need until notification
sending is actually built), and a trigger point in the existing `settleCompetition`/entry
flows to enqueue a notification. None of this was built — it wasn't asked for beyond
"prepare the architecture," and the existing data model already has everything a
notification system would read from.

---

## 10. App Store / Google Play considerations (not implemented — documented)

None of the following were created or invented this phase — real IDs, keys, and
certificates only ever come from actually registering with Apple/Google:

- **Bundle identifier / package name**: not registered anywhere yet. Convention would be
  reverse-DNS, e.g. `com.perfect2.app` (iOS bundle ID) / `com.perfect2.app` (Android
  package name) — a real decision for whoever owns the Apple Developer / Google Play
  Console accounts, not something to hardcode speculatively.
- **EAS (Expo Application Services)**: the standard path to producing signed iOS/Android
  builds without local native toolchains — requires an Expo account and, for store
  submission, real Apple Developer Program ($99/year) and Google Play Developer ($25
  one-off) accounts, neither of which exist yet.
- **App icons / splash screen**: Expo's default placeholder assets are in place; real
  branded assets are a design task, not an engineering one.
- **Deep linking**: Expo Router supports this natively once a URL scheme/associated domain
  is decided (e.g. `perfect2://` and/or a universal link domain) — not configured yet since
  there's no production domain to associate.
- **Production API URL**: the mobile app needs an `EXPO_PUBLIC_API_URL` environment
  variable pointing at the deployed Next.js app's URL (see §11) — currently unset; there is
  no production deployment of this project yet.
- **Secure environment variables**: EAS supports encrypted secrets for build-time config
  (e.g. a future Sentry DSN or analytics key) — none needed yet since nothing sensitive is
  currently baked into the client.

**Nothing was submitted to either store. No production credentials exist anywhere in this
repository.**

---

## 11. Mobile project — what's real right now

- `mobile/` is a working Expo + TypeScript project (`create-expo-app`, blank-typescript
  template), with its own `package.json`, `tsconfig.json`, and `app.json`.
- `EXPO_PUBLIC_API_URL` is the environment variable the app reads for the Next.js API's
  base URL (Expo's convention: any env var prefixed `EXPO_PUBLIC_` is inlined into the
  client bundle at build time — this is fine for a public API base URL, but this is exactly
  why nothing secret should ever be given that prefix). See `mobile/.env.example`.
- A minimal typed API client (`mobile/lib/api.ts`) wraps `fetch` against the same response
  envelope the Next.js routes return, with the bearer token read from
  `expo-secure-store`.
- One real screen wired to the live (currently empty) API — the sport picker calling
  `GET /api/sports` — proving the mobile-to-Next.js round trip actually works, end to end,
  through the real database connection. It intentionally shows almost nothing else yet:
  building out the full picks/entry/results UI described in the brief's product-vision
  flow is real future work, not simulated here.

---

## 12. Champion Data dependency

**Unchanged by this phase.** Still not connected — no credentials, no endpoints, no
response formats invented anywhere, on either the Next.js or the mobile side. The mobile
app reads exactly the same (currently empty) database the web app does, through the same
API boundary, so connecting Champion Data later populates both clients simultaneously with
zero mobile-specific work.

---

## 13. Remaining work

- Champion Data integration (blocked on their response — dedicated future phase).
- The full mobile UI: round browsing, the pick-2-players screen, entry review/confirm,
  "My Entries," entry results, competition results — the web app already has all of these
  as a reference implementation; the mobile versions are new screens against the same API.
- Real payment processing (Apple/Google IAP compliance research is a prerequisite — see §8).
- Password reset (needs a transactional email provider).
- Social login / Sign in with Apple (needs real Apple/Google credentials).
- Push notification delivery (architecture-ready, not implemented — see §9).
- Admin surface for `closeCompetition`/`settleCompetition` (the functions exist; no UI
  calls them yet).
- A scheduler/cron to call `closeCompetition`/`settleCompetition` automatically.
- EAS project setup, real bundle ID/package name, and eventual store accounts (§10).
- A production deployment of the Next.js app so `EXPO_PUBLIC_API_URL` has something real
  to point at.
