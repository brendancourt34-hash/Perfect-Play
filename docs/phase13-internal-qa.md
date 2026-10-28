# Perfect Play — Phase 13: Internal QA + End-to-End Test

**Status:** Full backend/API end-to-end QA pass complete against real, temporary,
clearly-marked test data. All temporary data deleted and verified gone. Mobile UX
reviewed via source inspection and bundle verification (no physical device/simulator
available in this environment — see §9).

**"All temporary QA data was deleted after testing and no QA/test records remain in the
production development database."** — confirmed, see §12.

---

## 1. QA environment

Next.js dev server (`npm run dev`) against the real, existing Neon database, driven via
direct HTTP requests (`curl`) to the actual `/api/*` routes — the exact same endpoints the
mobile app calls (`mobile/lib/api.ts`). This is genuine end-to-end testing of the real
server code paths, not a mock. Mobile itself was verified via TypeScript, its own test
suite, and `expo export` for both platforms (see §9) — no iOS Simulator or Android
Emulator is available in this sandboxed environment, so on-device tap-through testing did
not occur and is not claimed.

---

## 2. Temporary test data

Created by `scripts/qa-seed.ts`, deleted by `scripts/qa-cleanup.ts` (both kept in the repo
as reusable, clearly-labelled QA tooling — see §11). Every row is unmistakably QA-only:

- **2 sports**: `nrl`/`afl` with names prefixed "QA TEST —"
- **2 seasons**: label "QA TEST SEASON — DELETE ME"
- **2 rounds**: name "QA TEST ROUND 1 — DELETE ME"
- **8 teams** (4 NRL: Alpha/Bravo/Charlie/Delta, 4 AFL: Echo/Foxtrot/Golf/Hotel), all
  named "QA Test Team …" with `external_id`s prefixed `qa-team-`
- **5 games** (3 NRL, 2 AFL), `external_id`s prefixed `qa-`
- **16 players** (8 NRL, 8 AFL), first name "QA", last name describing their test role
  (e.g. "Scorer Alpha1", "NonScorer Bravo2"), `external_id`s prefixed `qa-player-`
- **2 QA users**: `qa-test-internal@perfect2.test` and `qa-test-internal-2@perfect2.test`
  (`.test` is an IANA-reserved, never-resolvable TLD — deliberately chosen so this address
  could never collide with or be mistaken for a real account)

Deliberately engineered stat distribution (documented fully in §8) so every settlement
scenario in the brief could be proven from one lean dataset: each of the two NRL "final"
games has one scorer and one non-scorer per team; the third NRL game starts unfinished
(to prove PENDING) and is finalized mid-test (to prove an entry can still resolve to
PERFECT after a pending game completes).

---

## 3. Authentication tests — PASS

| Check | Result |
|---|---|
| Register | ✅ 201, user + token returned |
| Duplicate register (same email) | ✅ rejected: "An account with this email already exists." |
| `/api/auth/me` with valid token | ✅ 200, correct user |
| Logout | ✅ session revoked |
| `/api/auth/me` with revoked token | ✅ 401 |
| Login again (fresh token) | ✅ 200 |
| Login, wrong password | ✅ 401 |
| `/api/auth/me`, no token at all | ✅ 401 |

Session tokens are opaque 32-byte random values; only their SHA-256 hash is ever stored
server-side (unchanged from Phase 10/11) — confirmed by code, not re-derived here.
"Secure storage" on the mobile side (`expo-secure-store`, never `AsyncStorage`) was
verified by source inspection of `mobile/lib/api.ts`/`auth-context.tsx` — no device was
available to confirm the OS keychain write itself occurs (see §9).

---

## 4. NRL tests — PASS

`GET /api/nrl/rounds/1` returned the round, all 3 games, both teams per game, every
eligible player (no position filtering), `competition.state: "open"`, `entryFeeCents: 500`
($5), `prizeAmountCents: 6000` ($60). `selectionLabel: "Try Scorer"`.

---

## 5. AFL tests — PASS

`GET /api/afl/rounds/2` returned its own round/games/players independently — different
`competitionId` (2, vs NRL's 1) confirmed at every step. `selectionLabel: "Goal Kicker"`
(vs NRL's "Try Scorer" — proves the sport-specific config is actually driving the response,
not a shared/hardcoded string). An AFL entry (any-two-player, same-team H2, cross-team H1)
settled correctly using `goals`, and `GET /api/entries` (the "My Entries" list) showed both
the NRL and AFL entries in one response, each correctly labelled with its own `sportCode`
and `roundId` — proving separation is structural, not just visual.

---

## 6. Selection tests — PASS

Two full entries were submitted covering every combination the brief asked for:

- **Entry 1** — Game 1: `QA Scorer Alpha1` (Fullback) + `QA Scorer Bravo1` (Halfback) —
  **cross-team**. Game 2: `QA Scorer Charlie1` (Hooker) + `QA Scorer Charlie2` (Centre) —
  **same-team**. Game 3: `QA NonScorer Alpha2` (Prop) + `QA Scorer Charlie1` (Hooker).
- **Entry 2** — Game 1: `QA Scorer Alpha1` (Fullback) + `QA NonScorer Bravo2`
  **(Winger)** — cross-team, and deliberately includes a winger to prove wingers are
  fully selectable, not restricted. Game 2: `QA NonScorer Delta1` + `QA NonScorer Delta2`
  — same-team.

Both entries span 4 distinct positions (Fullback, Halfback, Hooker, Centre, Prop,
Winger, Five-Eighth, Lock across the two) with no position-based rejection anywhere.

Also confirmed:
- Duplicate player in the same slot → rejected ("The two selected players must be
  different.")
- Incomplete round (a game missing) → rejected ("Missing selection for game 3.")
- A player who belongs to a *different* game in the same round → rejected ("Selected
  player 2 is not eligible for this game.")

Progress indicator, in-flow selection persistence, and "edit before submit" are mobile
client-state behaviors (`entry-draft-context.tsx`) verified by source review — confirmed
correct by code inspection (the picks map only ever clears on explicit `reset()`, called
solely on successful submission) since no device was available to tap through it live.

---

## 7. Submission tests — PASS

- Authenticated `POST /api/nrl/rounds/1/entries` → 201, real `entryId` returned.
- `SELECT * FROM competition_entries` after all 3 entries: every single row shows
  `payment_status: 'pending'`, `paid_amount_cents: null` — **confirmed directly in the
  database**, not just from an API response — no fake payment success anywhere, no code
  path exists that could set it otherwise (there is no payment-processing code in this
  project at all).
- Entry ownership (`user_id`) in the database matched the actual authenticated session
  for every entry (Entry 1 & 3 → user id 2, Entry 2 → user id 3) — confirmed the API never
  lets the client choose its own `userId`; `createEntry`'s only client input is
  `selections`, the user comes exclusively from the verified session.

---

## 8. Settlement tests — PASS (all 7 required scenarios, proven live)

| # | Scenario | Setup | Result |
|---|---|---|---|
| 1 | Both selected players ≥1 stat → game PERFECT | Entry 1, Game 1 (2 tries + 1 try) | ✅ `perfect` |
| 2 | One selected player = 0 → game NOT PERFECT | Entry 2, Game 1 (2 tries + 0 tries) | ✅ `not_perfect` |
| 3 | Both selected players = 0 → game NOT PERFECT | Entry 2, Game 2 (0 + 0) | ✅ `not_perfect` |
| 4 | Incomplete/unfinished game → PENDING | Both entries, Game 3 (not yet final) | ✅ `pending` |
| 5 | Every game PERFECT → entry PERFECT | Entry 1, after Game 3 finalized (all 3 perfect) | ✅ `perfect` |
| 6 | One game NOT PERFECT → entry NOT PERFECT | Entry 2 (Games 1 & 2 already not_perfect while Game 3 still pending) | ✅ `not_perfect` — proves a failure locks the entry even before every game finishes |
| 7 | Unfinished games → entry PENDING | Entry 1, before Game 3 finalized | ✅ `pending` |

**Immutability, proven live (not just unit-tested):** after Game 3 was finalized, Entry
1 correctly flipped from `pending` → `perfect`, while Entry 2 — whose Game 1/2 selections
had already settled to `incorrect` while Game 3 was still pending — stayed `not_perfect`
even though its own Game 3 pick independently resolved to `perfect`. This is the exact
"already-settled selections are never recomputed, only still-pending ones are" rule
(`settleEntrySelections`, Stage 8/Phase 9) working correctly against real data flowing
through the real API, not a mock.

**No numeric scoring anywhere**: every response field is one of exactly `pending` /
`correct` / `incorrect` (selection) or `pending` / `perfect` / `not_perfect` (game/entry)
— confirmed directly from the raw JSON responses throughout, not summarized.

**Competition lifecycle, also exercised live** (no HTTP route exists for this yet — called
`closeCompetition`/`settleCompetition` directly, exactly as a future admin action/cron
would): `closeCompetition` correctly transitioned `open → closed`; `settleCompetition`
correctly detected all games final and transitioned `closed → settled`, returning
`perfectEntryIds: [1]`, matching `entriesSettled: 2`. Calling both a second time was a
verified no-op (idempotent) — no duplicate transition, no error, same result returned.
`GET /api/nrl/rounds/1/results` then correctly showed `state: "settled"`,
`entrantsTotal: 2`, `perfectCount: 1`, `notPerfectCount: 1`, `perfectEntryIds: [1]`,
`prizeAmountCents: 6000` — no ranking, no points, no personal data (only the entry ID).

---

## 9. Security tests — PASS

| Check | Result |
|---|---|
| Access another user's entry (`GET /api/entries/1` as user 3, owner is user 2) | ✅ 403 |
| Access an entry unauthenticated | ✅ 401 |
| Create an entry unauthenticated | ✅ 401 |
| Cross-sport contamination: `afl` slug + NRL round ID | ✅ 422, "This round does not belong to the selected sport's competition." |
| Cross-sport contamination, reverse direction: `nrl` slug + AFL round ID | ✅ same rejection |
| Wrong-game player (a player from a different game in the round) | ✅ 422, "Selected player 2 is not eligible for this game." |
| Duplicate player in one selection | ✅ 422, "The two selected players must be different." |
| Duplicate entry (same user, same competition, twice) | ✅ 422, "You already have an entry in this Perfect Play NRL round." |
| Entry against a game that's already started/final | ✅ 422, "Selections are locked for the … game — it has already started." (this actually surfaced first during QA setup — see the note below) |
| Client cannot supply another user ID | ✅ confirmed by code review (`POST .../entries` only ever reads `body.selections`; the owning user comes exclusively from the verified session) and by database inspection (every entry's `user_id` matched its real submitter, id 2 or 3, never anything else) |
| Client cannot fake payment state | ✅ confirmed directly in the database — `payment_status` is `'pending'` on every entry; no code path in the project can set it to `'paid'` |

**A genuine QA finding, not a bug**: the first seed attempt marked NRL games 1–2 as
already `final` (to make settlement easy to test immediately), which caused every
initial entry-submission attempt to be correctly rejected as "already started." This
proved the entry-lock is working exactly as designed — you truly cannot enter a
competition for a game that's already finished — but it meant the QA sequence had to be
corrected: seed games as `scheduled` with a future kickoff, submit entries, *then*
simulate the games finishing (`scripts/qa-finalize-game.ts`), mirroring how a real
pre-kickoff → post-match data sync would actually happen. This is documented as a QA
process correction, not an application bug.

---

## 10. UX findings & fixes made

Reviewed every mobile screen's source for the brief's checklist (clipped text, spacing,
keyboard handling, touch target size, modal/navigation issues, loading/error/empty
states, back-navigation, typography/spacing consistency, unclear CTAs). Three genuine
issues found and fixed this phase:

1. **Confirmation screen could still be swiped back to on iOS**, risking a confusing
   re-submit attempt — `headerBackVisible: false` only hides the header button, not the
   iOS edge-swipe gesture. **Fixed**: added `gestureEnabled: false` alongside it
   (`app/round/[sport]/[roundId]/_layout.tsx`). Server-side duplicate-entry rejection
   already made a resubmit harmless either way (§9), but the navigation UX is now
   correct too. *(Android hardware back-button interception would need a dedicated
   `BackHandler` listener — not added this phase, noted in §14 as a known limitation
   rather than over-built for a low-impact edge case already covered server-side.)*
2. **Account screen's "Log out" button had its horizontal padding stripped to 0**,
   shrinking its tappable width to roughly the text's own bounding box — borderline
   against comfortable touch-target guidance. **Fixed**: restored the button's normal
   padding.
3. **The pick screen's progress bar rendered even with zero pickable games** (i.e. when
   the round has games but all have already started), showing a redundant "0/0 games
   complete" above the "No games available to pick" empty state. **Fixed**: the progress
   bar now only renders when there's at least one game to pick.

Also tightened a loose `string` type on `CompetitionResults.competition.state` to the
proper 4-value union (removing a redundant `as` cast in `results.tsx`) — a type-safety
cleanup surfaced during the review, not a runtime bug.

No other genuine issues were found. Every screen already had explicit loading, error
(plain message + retry, never a raw stack trace), and empty states from Phase 12; keyboard
avoidance is present on both auth screens; every interactive element carries an
`accessibilityLabel`/`accessibilityRole`; button minimum height is enforced at 44pt
(`minTouchTarget`) project-wide.

---

## 11. Cleanup verification

`scripts/qa-cleanup.ts` deletes by matching the QA markers (sport codes `nrl`/`afl` —
the only sports this run created — and the `qa-test-internal%@perfect2.test` email
pattern), not by trusting remembered IDs, and works in explicit leaf-to-root order
(selections → entries → competitions → stats/lineups → games → players/teams →
rounds → seasons → sports → sessions → users) rather than relying solely on
cascading deletes. Run once, confirmed:

```
Deleted: { entrySelections: 3, competitionEntries: 3, competitions: 2, games: 5,
  players: 16, teams: 8, rounds: 2, seasons: 2, sports: 2, users: 2 }
```

Final check — **13 tables, 0 rows, every table** — matches the pre-seed baseline exactly.

The five `scripts/qa-*.ts` files themselves (seed, set-scheduled, finalize-game,
close-and-settle, cleanup) were **kept** in the repository as reusable QA tooling for
future internal test rounds — they're clearly named, only ever touch QA-marked rows, and
the cleanup script is a safe no-op against a clean database. This is a deliberate
distinction: the brief asked that no *test data* remain, not that the *tooling* that
produces and removes it be deleted.

---

## 12. Test results summary

| Category | Result |
|---|---|
| Authentication | ✅ PASS |
| NRL browsing/selection/submission/my-entry/results | ✅ PASS |
| AFL (full separate journey) | ✅ PASS |
| Settlement (all 7 required scenarios) | ✅ PASS |
| Security (10 checks) | ✅ PASS |
| Mobile UX review | ✅ PASS (3 fixes applied) |
| Cleanup | ✅ PASS — 0 rows confirmed |

---

## 13. Build results

- `npm run lint` ✅ clean
- `npm run test` ✅ **103/103**
- `npm run build` ✅ (13 pages + 12 API routes)
- Mobile `npx tsc --noEmit` ✅ clean
- Mobile `npx vitest run` ✅ **9/9**
- Mobile `npx expo export --platform ios` ✅ (2.4MB bundle)
- Mobile `npx expo export --platform android` ✅ (2.6MB bundle)
- Dev smoke test (post-cleanup, empty DB) ✅ all pages/API routes correct, no errors

---

## 14. Known limitations

- **No physical device, iOS Simulator, or Android Emulator was available in this
  environment.** All mobile verification is TypeScript correctness + the app's own test
  suite + successful platform bundle exports + careful source-level UX review — genuine,
  but not the same as tapping through the app on a real device. This is stated plainly
  per the brief's explicit instruction not to claim interactive device testing that
  didn't happen.
- Android hardware back-button interception on the confirmation screen isn't implemented
  (iOS swipe-back is, via `gestureEnabled: false`) — low-impact since the server already
  rejects a resubmit attempt as a duplicate entry regardless.
- No admin UI calls `closeCompetition`/`settleCompetition` yet — this phase called them
  directly via a script, exactly as a future admin action or cron job would.

---

## 15. Champion Data status

**NOT CONNECTED.** Untouched this phase, per instruction. The QA sports/teams/games/
players/stats used above were temporary, clearly-marked test fixtures created and
destroyed entirely within this phase — at no point did they touch, resemble, or get
confused with a Champion Data integration, which still doesn't exist anywhere in this
codebase.

## 16. Payment status

**NOT IMPLEMENTED.** Every QA entry's `payment_status` stayed `'pending'` throughout —
confirmed directly in the database (§7), not merely from a UI label.

## 17. Recommended next phase

The backend/API layer is now proven correct end-to-end against real data for every
scenario the product currently requires. The highest-value next step is either (a) resume
Champion Data integration once they respond, since the sports-data layer (Stage 8) is
unchanged and ready, or (b) invest in a `jest-expo` + React Native Testing Library harness
so the mobile screens themselves can be tested without a physical device — this QA phase
proved the API thoroughly but the mobile UI's interactive behavior is still verified by
code review rather than automated test, which is the main gap this phase leaves open.
