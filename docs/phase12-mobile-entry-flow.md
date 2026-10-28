# Perfect Play — Phase 12: Mobile Entry Flow

**Status:** Full native customer entry journey implemented and verified against the live
API. No fake sports data, no fake payments, no Champion Data connection.
**Date:** 2026-09-04

"Champion Data integration remains intentionally paused pending the provider response.
The mobile application is now structured to consume real sports data through the
existing provider-agnostic backend/API once official Champion Data access details are
available."

---

## 1. Mobile architecture

`mobile/` (Expo + TypeScript, React Native, **Expo Router** for file-based navigation —
chosen over hand-wired React Navigation because it mirrors the mental model of the
Next.js App Router this project already uses, and because it's Expo's current
recommended default). Three layers:

```
app/            — screens, one file per route (Expo Router convention)
components/     — reusable UI (Button, Card, StatusBadge, PlayerPickerSheet, ScreenStates)
lib/            — api.ts (server client), auth-context.tsx, entry-draft-context.tsx, format.ts
constants/      — theme.ts (design tokens), sports.ts (static NRL/AFL labels/routing)
```

No business logic lives in `app/` or `components/` — every screen calls `lib/api.ts`,
which calls the real Next.js API, which calls the same data-access/settlement functions
the web app uses. Nothing about eligibility, pricing, competition status, or settlement is
computed on-device.

---

## 2. Screens created

| Screen | Route | Purpose |
|---|---|---|
| Login | `(auth)/login` | Email/password sign-in |
| Register | `(auth)/register` | Account creation |
| Home | `(tabs)/index` | Perfect Play branding, NRL/AFL cards, round counts |
| NRL | `(tabs)/nrl` | NRL round list (via shared `SportRoundListScreen`) |
| AFL | `(tabs)/afl` | AFL round list (same shared component, own data) |
| Account | `(tabs)/account` | Email, logout, "My Entries" list across both sports |
| Round detail | `round/[sport]/[roundId]/index` | Competition status/fee/prize/times + games |
| Picks | `round/[sport]/[roundId]/enter` | The 2-player-per-game selection screen |
| Review | `round/[sport]/[roundId]/review` | Full picks summary before submit |
| Confirmation | `round/[sport]/[roundId]/confirmation` | Post-submit receipt, honest payment state |
| Results | `round/[sport]/[roundId]/results` | Entrant/perfect/pending/not-perfect counts, prize, winners |
| My Entry | `entry/[entryId]` | Per-game PENDING/CORRECT/INCORRECT breakdown |

Every screen has a loading state, an error state (plain message + retry, never a raw
stack trace), and an empty state where relevant ("No rounds available", "No entries yet",
"No games available to pick").

---

## 3. Navigation structure

```
app/_layout.tsx                     — AuthProvider + root Stack, waits out the initial
                                       session check, then renders the auth-gated tree
app/(auth)/_layout.tsx              — redirects to (tabs) if already logged in
app/(auth)/login.tsx
app/(auth)/register.tsx
app/(tabs)/_layout.tsx              — bottom tab bar; redirects to (auth)/login if signed out
app/(tabs)/index.tsx                — Home
app/(tabs)/nrl.tsx                  — NRL
app/(tabs)/afl.tsx                  — AFL
app/(tabs)/account.tsx              — Account
app/round/[sport]/[roundId]/_layout.tsx   — wraps EntryDraftProvider, scoped to one round's flow
  index.tsx / enter.tsx / review.tsx / confirmation.tsx / results.tsx
app/entry/_layout.tsx
app/entry/[entryId].tsx
```

Auth gating uses `<Redirect>` inside each group's own layout (not a newer/uncertain
"Protected routes" API), which is the long-stable Expo Router pattern and avoids
depending on an SDK 57 feature not independently confirmed in this environment.

The in-progress pick state (`EntryDraftProvider`) is scoped to exactly one round's
sub-tree — it's created when the user enters `round/[sport]/[roundId]/*` and discarded
when they leave it. A half-finished entry is never sent to the server and never persists
across app restarts; only a successful submit creates anything server-side.

---

## 4. API usage

`mobile/lib/api.ts` wraps every route from `src/app/api/`:
`getSports`, `getRounds`, `getRoundDetail`, `getResults`, `createEntry`, `listMyEntries`,
`getEntry`, `register`, `login`, `logout`, `getCurrentUser`. Same JSON envelope on both
ends (`{ ok: true, data }` / `{ ok: false, message, errors? }`).

**One backend change this phase**: `listEntriesForUser` (and therefore
`GET /api/entries`) was extended to join through `competitions → rounds → sports` and
return `sportCode`/`roundId`/`roundName`/`roundNumber` per entry — needed so the Account
screen can label each entry ("NRL — Round 5") without an extra round-trip per row. This is
the only API/data-layer change made to support mobile; every other screen was served by
the routes already built in the previous phase.

`EXPO_PUBLIC_API_URL` is read from the environment (`mobile/.env.example`), never
hardcoded to `localhost` in a way that would ship to production — it's a per-environment
config value, same as the rest of the project's env-var discipline.

---

## 5. Authentication

`lib/auth-context.tsx` is the single source of "who's signed in," backed entirely by the
real server session (`/api/auth/*`, unchanged from the previous phase). On cold start it
checks `expo-secure-store` for a token and calls `/api/auth/me`; an expired/invalid token
is cleared silently rather than surfaced as an error. Login/Register screens are fully
functional against the live API — real validation errors from the server (wrong password,
duplicate email, weak password) are shown, not swallowed. Tokens are stored via
`expo-secure-store` exclusively — `AsyncStorage` is never used for the session token.

---

## 6. Entry flow

`round/[sport]/[roundId]/index` → **enter** → **review** → submit → **confirmation** →
**My Entry**. The round-detail screen only shows the "ENTER PERFECT PLAY — $X" button when
the API's `competition.state` is `"open"` — the client renders what the server says, it
doesn't compute this itself. Entry creation (`POST /api/[sport]/rounds/[roundId]/entries`)
independently re-validates everything (competition state, eligibility, duplicates) exactly
as it did for the web app — the mobile UI hiding a button is a courtesy, not the actual
lock.

---

## 7. Player selection

`enter.tsx` renders every game in the round with two pick slots. Tapping a slot opens
`PlayerPickerSheet` — a full-screen modal listing **every player the API returned as
eligible for that game**, from either team, with a live search field and a virtualized
`FlatList` (`initialNumToRender`/`maxToRenderPerBatch`/`windowSize`/`removeClippedSubviews`
tuned for a "many players" round without hand-rolling pagination). Position is shown next
to each player's name for information only — nothing in this component, or anywhere else
in the mobile app, filters the list by position. The already-picked player for the other
slot is shown (disabled, labelled "Other pick") rather than hidden, so it's clear why it
can't be tapped, and duplicate selection is structurally impossible rather than merely
discouraged.

---

## 8. Validation

Client-side (`enter.tsx`/`review.tsx`): a game only counts as "complete" once it has two
distinct player IDs (`isGameComplete` in `entry-draft-context.tsx`); the "Review picks"
button is disabled until every game is complete, with live progress ("3 / 9 games
complete" + a progress bar). This is purely a UX convenience.

**The server remains the source of truth** — every one of the rules `createEntry`
(`src/lib/data/entries.ts`) already enforced for the web app applies identically here,
unchanged this phase: correct sport/round (cross-sport contamination guard), valid
player-in-this-game, distinct players, competition open, authenticated, duplicate-entry
rejection. A malicious client that skipped the mobile UI's checks and called the API
directly would be rejected exactly the same way.

---

## 9. Review

Lists every game with both selected players' names, restates "no points are involved,"
and shows the entry fee before two actions: **Edit picks** (back to the pick screen,
draft preserved) and **ENTER PERFECT PLAY — $X**.

---

## 10. Confirmation

Shows competition, round, entry number, entry fee, and — explicitly — **"Payment:
NOT YET PROCESSED"** plus a note that payment collection isn't connected yet and the
entry isn't yet confirmed for the prize pool. No fake success state, no invented
payment confirmation. Matches the honest state the backend actually returns
(`paymentStatus: "pending"`).

---

## 11. My Entry

Per-game breakdown: teams, both selected players with their actual try/goal count
(`formatStatLabel`, sport-aware singular/plural — "1 try", "0 goals"), a
correct/incorrect badge per player, and a perfect/not-perfect badge per game. The entry
header shows exactly `PERFECT` / `NOT PERFECT` / `PENDING` with the brief's exact
descriptions. Numeric stat counts are displayed as factual sports statistics — nowhere are
they summed, weighted, or turned into a score.

---

## 12. Results

`results.tsx` shows entrant/perfect/pending/not-perfect counts as plain stat tiles, the
configured prize amount (never hardcoded), and a winners section: not-yet-settled shows a
waiting message; zero perfect entries shows **"NO PERFECT ENTRIES"** verbatim; one or more
shows an unranked list of **"Entry #N"** rows — no names, no emails, no ranking, no "1st
place."

---

## 13. Account

Email, name (if set), logout, and "My Entries" — every entry across both sports, each
row labelled with its sport and round (via the API extension in §4) and its current
`PerfectBadge`. Tapping a row opens that entry's full result.

---

## 14. Security

- Every authenticated route call includes the bearer token from `expo-secure-store`
  automatically (`lib/api.ts`'s `request()` helper) — screens never handle the token
  directly.
- `POST .../entries` always creates the entry under the *authenticated* session's user —
  the client never sends a user ID.
- `GET /api/entries/:id` is ownership-checked server-side (403 on mismatch) — unchanged
  from the previous phase, exercised identically by the mobile "My Entry" screen.
- No secret, API key, or database credential exists anywhere in the mobile bundle —
  confirmed by inspecting `mobile/.env.example` and the `EXPO_PUBLIC_*` convention (only
  the public API base URL uses that prefix).
- Sensitive session tokens use `expo-secure-store` exclusively, never `AsyncStorage`.

---

## 15. Tests

**Preserved:** all 100 existing Next.js tests, unaffected.

**Added this phase (Next.js side, pure functions — 3 new):**
`normalizeAndValidateEmail` (`src/lib/auth/password.ts`) — extracted from the inline
regex previously embedded in `registerUser`, now independently tested (valid email,
trim/lowercase normalization, malformed rejection).

**Added this phase (mobile side, new lightweight vitest setup — 8 new):**
`mobile/lib/format.test.ts` — money formatting (whole-dollar vs. fractional, matches the
$5/$60 defaults), stat-label singular/plural, and safe fallback behavior for missing/invalid
dates rather than throwing.

**Deliberately not added (and why, rather than padding with hollow tests):**
- Full screen/component tests (login flow, picker interaction, navigation) would require
  `jest-expo` + React Native Testing Library — a real, non-trivial testing harness this
  phase didn't set up, since the brief's priority was the working feature, not new test
  infrastructure. `mobile/vitest.config.ts` is scoped to `lib/**/*.test.ts` specifically
  because anything importing `react-native`/`expo-router`/`expo-secure-store` can't run in
  plain Node without that harness.
- "Entry flow: same-team/cross-team/duplicate-player/wrong-game/incomplete-round/closed-
  competition rejected" — **already covered** by the existing
  `src/lib/selections/validate.test.ts` and `src/lib/competitions/lifecycle.test.ts` suites
  from the previous phase; the mobile entry flow calls the exact same server-side
  validation, so no new server test was needed to prove these rules — they're unchanged.
- "Duplicate entry rejected" / "unauthenticated creation rejected" / API route tests —
  these are database- and HTTP-request-touching, consistent with this project's existing
  convention (established since Stage 6) that DB-touching data-access/route code isn't
  part of the fast pure-function unit suite; they were manually verified instead (see §16).
  A real integration-test setup (a disposable test database + supertest-style route
  invocation) is legitimate future work, not something to fake with a mocked DB here.

---

## 16. Build results

- **Next.js**: `npm run lint` ✅ clean · `npm run test` ✅ **103/103** (100 preserved + 3 new)
  · `npm run build` ✅ (13 pages + 12 API routes)
- **Mobile TypeScript**: `npx tsc --noEmit` ✅ clean
- **Mobile tests**: `npx vitest run` ✅ **8/8** (new this phase)
- **iOS export**: `npx expo export --platform ios` ✅ — 1,131 modules, successful `.hbc`
  bundle (2.4MB)
- **Android export**: `npx expo export --platform android` ✅ — 1,266 modules, successful
  bundle (2.8MB) — confirms cross-platform compatibility without a physical/emulated
  device
- **Dev smoke test**: Next.js dev server — all pages/API routes respond correctly
  (honest 404s where the empty database has nothing to show); auth round trip
  (register → me → login → logout) manually verified end-to-end against the live database,
  then the test account was deleted so the database remains at 0 rows

---

## 17. Remaining work

- Full component/integration test harness for mobile (`jest-expo` + RNTL) — not set up
  this phase.
- Physical-device / simulator manual QA (this environment can build and bundle the app but
  cannot launch an iOS Simulator or Android Emulator to click through the UI).
- EAS project registration, real bundle ID/package name ownership, app icons/splash design.
- Deep linking configuration beyond the `perfect2://` scheme already set in `app.json`.
- Payment processing (still blocked on the Apple/Google IAP compliance question documented
  in `docs/mobile-app-architecture.md` §8).
- Push notification delivery (architecture-ready, not built).
- Admin UI for the existing `closeCompetition`/`settleCompetition` functions.
- A "My Entries" pull-to-refresh / real-time result update (currently refresh-on-mount +
  pull-to-refresh on the round list; the entry/results screens are refresh-on-mount only).

---

## 18. Champion Data dependency

Unchanged. Still not connected — no credentials, endpoints, or response formats invented
on the mobile side any more than the backend side. The mobile app reads exactly the same
(still empty) database as the web app, through the same API — connecting Champion Data
later populates both simultaneously with zero mobile-specific work.

---

## 19. Payment dependency

Unimplemented, and explicitly represented as such in the UI (`confirmation.tsx`'s
"NOT YET PROCESSED" state) — no fake success screen exists anywhere in the mobile app.
`competition_entries.paymentStatus` stays `"pending"` through the entire mobile flow,
exactly as it does for the web app.
