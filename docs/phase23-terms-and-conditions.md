# Perfect Play — Phase 23: Terms & Conditions

**Status:** Implemented and verified. Content is **DRAFT, pending real Australian
gambling-law legal review** — see §5 for exactly which sections are marked
"TO BE CONFIRMED — PENDING LEGAL REVIEW" and must not be treated as final.
**Date:** 2026-09-05

---

## 0. The legal gate — read this first

Building this versioning/acceptance system does **not** constitute legal authorization for
real-money deposits, entries, or withdrawals. Perfect Play has not been classified by
Australian gambling counsel (same gate as Phase 20's payment infrastructure). The seeded
v1.0 content:

- Never claims a gambling licence or regulatory authorisation exists (§25 is explicitly
  "TO BE CONFIRMED").
- Never fabricates an operator/company identity (§25).
- Never claims KYC/AML or responsible-gambling compliance beyond describing intent (§18).
- Describes the product exactly as it is actually built — no aspirational or fabricated
  features.

Real-money features remain disabled regardless of what these Terms say; they describe how
the feature will work once enabled, not a claim that it is enabled now.

---

## 1. Data model

Two tables (`src/db/schema.ts`), migrated in `scripts/migrate-add-wallet-packages-terms.ts`:

- **`terms_versions`** — one row per version. `status` is `draft | published | archived`.
  `content` is `TermsSection[]` (`{heading, body}[]`) — structured, never a single wall of
  text, so the client renders it as an accordion. At most one row can be `published` at
  any time (enforced by application logic, not a DB constraint — see §2).
- **`terms_acceptances`** — one row per (user, version) they actually accepted, unique on
  `(user_id, terms_version_id)`. Rows are **never deleted** when a newer version publishes
  — a user's historical acceptance always points at exactly the version and content they
  agreed to at the time, even after it's superseded.

## 2. Versioning & publishing (`src/lib/data/terms.ts`)

- `createDraftTermsVersion` — always creates status `draft`. Never auto-published.
- `updateDraftTermsVersion` — rejected (`not_draft`) once a version is `published` or
  `archived`. **Immutability**: editing published content would silently rewrite what a
  user already agreed to, so it's structurally disallowed. To change published content,
  create and publish a *new* version.
- `publishTermsVersion` — archives whatever is currently `published` (if any), then sets
  the target draft to `published` + `publishedAt = now()`. Not a single atomic transaction
  (neon-http has none — see `wallets` doc comment in `schema.ts`), but self-healing: a
  follow-up publish call always archives whatever it still finds `published`, and
  `getCurrentPublishedTerms` always takes the single `published` row via `LIMIT 1`.
- `getCurrentPublishedTerms` — the one source of truth for "what version is live right
  now." Every read path (public terms endpoint, acceptance checks) goes through this.

## 3. API surface

**Customer (no admin required):**
- `GET /api/terms` — the current published version. 404 if none has ever been published.
- `GET /api/me/terms-acceptance` — `{accepted, currentVersion}` for the signed-in user.
- `POST /api/me/terms-acceptance` — records acceptance. The `termsVersionId` sent by the
  client is checked against the version that's *actually* currently published — a
  stale/cached id (or an old version after a new one publishes) is rejected with 409, so a
  user can never be silently recorded as having agreed to terms they never saw.

**Admin (`requireAdmin`):**
- `GET /api/admin/terms`, `POST /api/admin/terms` — list / create a draft.
- `GET/PATCH /api/admin/terms/[id]` — detail / edit (edit rejected once non-draft).
- `POST /api/admin/terms/[id]/publish` — publish (archives whatever was published).
- `GET /api/admin/terms/[id]/acceptances` — every user who accepted this exact version,
  joined with their email — the audit trail for a specific version, preserved forever.

## 4. Admin UI (`/admin/terms`)

Two-pane layout: a list of every version (draft/published/archived) on the left, and a
form on the right. The form is editable only while the selected version is a draft (or
when starting a brand new one) — selecting a published/archived version renders it
read-only with its acceptance count. Sections are added/removed dynamically; publishing is
a separate explicit action from saving.

## 5. Content (v1.0, seeded by `scripts/seed-terms-v1.ts`)

26 sections covering: how Perfect Play works per sport, eligibility, registration, Perfect Play
Balance, entry fees/packages, selections, round cutoff, prize pool, prize pool visibility,
winning, rollover, results/sports data, postponed/cancelled games, player
non-participation, winnings, withdrawals, refunds, responsible gambling, privacy,
suspension/termination, fraud, technical issues, changes to Perfect Play,
complaints/disputes, operator/regulatory info, and applicable law.

Sections 2, 8, 16, 18, 19, 24, 25, and 26 explicitly contain
**"TO BE CONFIRMED — PENDING LEGAL REVIEW"** language for anything that cannot yet be
truthfully stated (jurisdictions, prize-pool methodology, real payout mechanism,
responsible-gambling tooling, the Privacy Policy itself, dispute resolution, operator
identity/licensing, and governing law). Section 11 (rollover) states "100% of it, with
nothing retained by Perfect Play" — this is verified true by construction: `settlePrizePool`
(`src/lib/perfect2/prize.ts`) sets `rolloverOutCents = currentPoolCents` exactly whenever
there are zero winners, never a partial amount.

## 6. Mobile UI

- **`app/terms.tsx`** — accordion viewing screen, reachable from Account, from
  registration, and from the wallet's deposit gate. Always shows whatever `GET /api/terms`
  currently returns.
- **Registration** (`app/(auth)/register.tsx`) — a mandatory checkbox ("I have read and
  agree to the Perfect Play Terms & Conditions and Privacy Policy") blocks submission until
  checked; on successful registration the app immediately calls
  `POST /api/me/terms-acceptance` with the version id that was current at the time the
  screen loaded.
- **Wallet deposit gate** (`app/wallet.tsx`) — before showing the deposit buttons, checks
  `GET /api/me/terms-acceptance`. If not accepted (covers users who registered before a
  version existed, or before a newer version was published), the deposit section is
  replaced with an inline agree-and-continue prompt; deposits become available immediately
  after accepting, without leaving the screen.

## 7. QA coverage

`scripts/qa-terms-and-conditions.ts` runs 25 checks against the real running backend and
the **real seeded v1.0 content** (not a fixture): public read, accept/idempotent
re-accept, permission boundaries, the full draft → edit → publish → auto-archive
lifecycle, immutability of published/archived versions, rejection of stale-version
acceptance attempts, and preservation of historical acceptances after a version is
superseded. It creates and deletes its own throwaway version and users, and explicitly
restores v1.0 to `published` afterward — it never deletes or permanently alters the real
seeded content, matching the same "don't delete real reference data" convention used by
`scripts/qa-phase22-nba.ts` for synced sports data.
