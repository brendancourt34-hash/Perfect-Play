# Perfect Play — Phase 9 + 10: Competition Engine & Results/Winners

**Status:** Implemented and verified. No sports-data provider connected, no payments, no auth.
**Date:** 2026-09-04

---

## Phase 9 — Competition Engine

### Competition lifecycle

The database still only stores 3 explicit statuses (unchanged from Stage 7):
`competitions.status ∈ {open, closed, settled}`. No new state was added.

`src/lib/competitions/lifecycle.ts` layers deterministic timing on top of that stored
status via `getEffectiveCompetitionState(competition, now)`:

```
status = "settled"                     → "settled"
status = "closed"                      → "closed"
status = "open" and now < opensAt      → "not_yet_open"   (derived, never stored)
status = "open" and now >= closesAt    → "closed"          (derived, never stored)
status = "open" otherwise              → "open"
```

`"not_yet_open"` is purely a display/logic concept — it's never written to the database.
Explicit status always wins over timing (a manually `closed` competition stays closed even
if `closesAt` is in the future). All comparisons use plain `Date`/UTC; no timezone is
hard-coded anywhere in this file — Australian-timezone formatting happens only in the UI
layer (`formatAuDateTime`), never in business logic.

`canAcceptEntries(competition, now)` is just `getEffectiveCompetitionState(...) === "open"`
— the single source of truth `createEntry` calls before writing anything.

### Opening, closing, and manual close

- **Opening**: implicit — a competition defaults to `status: "open"` when first created
  (`getOrCreateCompetition`, unchanged from Stage 7/8).
- **Closing**: `closeCompetition(competitionId)` (`src/lib/data/competitions.ts`) — verifies
  the competition exists, and transitions `open → closed`. Idempotent by construction: the
  pure decision `decideCloseAction(status)` (lifecycle.ts) returns `"noop"` for anything
  already `closed` or `settled`, so calling it twice — or calling it on a settled
  competition — never regresses or corrupts state. Independent of any UI; intended to be
  called later by a scheduler or admin action, neither of which exists yet.

### Server-side entry validation (hardened this phase)

`createEntry` (`src/lib/data/entries.ts`) now runs, in order:

1. **Cross-sport contamination guard (new this phase)** — loads the round, loads its
   season, and rejects unless `season.sportId === input.sportId`. This is a real fix: an
   NRL round can never become the basis of an AFL competition (or vice versa) even if a
   malicious or buggy client sends a mismatched `sportSlug`/`roundId` pair. Previously
   nothing checked this.
2. Every game in the round has exactly one selection, no selection references a game
   outside the round (`validateEntrySelections`, unchanged from Stage 6).
3. Per selection: both players eligible for that specific game (from real `game_lineups`
   data, no position rule), the two players are different, and the game hasn't already
   locked (`validateSelection` + `isSelectionLocked`, unchanged from Stage 6).
4. **`canAcceptEntries(competition)` (new this phase)** — replaces the old raw
   `competition.status !== "open"` check with the full timing-aware lifecycle check. This
   is the server-side lock the brief required: a client cannot get an entry created by
   hiding a disabled button, waiting past `closesAt`, or calling the server action directly
   after the round visually shows "closed" — every path re-checks this.
5. **Duplicate-entry pre-check (new this phase)** — looks up whether this user already has
   an entry for this competition before inserting, and returns a clean
   `{status: "invalid", errors: [...]}` rather than letting a raw Postgres unique-constraint
   violation surface. The database's `competition_entries_competition_user_unique`
   constraint remains as the real backstop guarantee either way.

### Entry immutability (no edit feature exists — by design, this phase)

There is no "edit an existing entry" server action anywhere in the codebase, and this
phase did not add one. The brief's instruction was conditional — *"allow selection changes
if the existing product architecture supports editing"* — and it doesn't, so nothing was
built to support it. Practically this means the entire "prevent bypassing the lock" list
from the brief is satisfied by **omission**, not by extra guard code:

| Attack considered | Why it can't happen |
|---|---|
| Direct server action call after close | `createEntry` re-checks `canAcceptEntries` every time — there's no separate "update" action to call instead |
| Modifying a selection ID directly | No endpoint accepts a selection ID for mutation — `entry_selections.player1Result`/`player2Result` are only ever written by settlement code (`getEntryWithResult`, `settleCompetition`), never by any user-facing action |
| Creating a second entry after close | Blocked twice over: `canAcceptEntries` rejects it, and even if that were bypassed, the duplicate-entry check (and DB constraint) would still reject it |
| Deleting an entry and recreating it | No delete-entry endpoint exists |
| Submitting a modified form after close | The server re-validates everything itself; nothing is trusted from the client |
| Changing competition/game/player IDs | `competitionId` is never client-supplied at all (derived server-side from sport+round); game/player IDs are validated against real `game_lineups` data every time |

### Settlement orchestration

`src/lib/data/settlement.ts`'s `settleCompetition(competitionId)`:

1. Loads the competition; rejects if it's still `open` (must be closed first).
2. Loads the round's games, all competition entries, all their selections, and all
   `player_game_stats` for those games.
3. For **every** entry, runs the same pure `settleEntrySelections` core used by
   `getEntryWithResult` (see below) — settling whatever selections are decidable and
   leaving the rest `pending`. Persists updated selection/entry results.
4. Only marks the **competition itself** `settled` once every game in the round is
   `final` (`decideSettleAction`, lifecycle.ts) — a competition with any unfinished game
   stays `closed`, even though its individual entries keep updating as games finish.
5. Returns a summary: entries settled, games total/final, whether the competition is now
   settled, and the list of perfect entry IDs.

This does not duplicate the business rules — both `settleCompetition` (bulk) and
`getEntryWithResult` (single entry, Stage 6/7/8) call the exact same
`settleEntrySelections` function in `src/lib/perfect2/settle.ts`, so there is exactly one
place that knows "tries/goals >= 1 → correct."

### Pending logic — precisely as specified

`settleGameSelection`/`settleEntry` (unchanged from Stage 6, re-verified this phase):

- A single **not_perfect** game ends the entry immediately as **NOT PERFECT**, even if
  other games in the round are still pending.
- With no not_perfect games but at least one still pending, the entry is **PENDING**.
- Only when every game is perfect does the entry become **PERFECT**.

Tested explicitly this phase with the brief's exact scenarios ("one incorrect game +
another pending game → NOT PERFECT", "all perfect so far + one pending → PENDING", "all
perfect → PERFECT") in `src/lib/perfect2/settle.test.ts`.

### Not inferred from match status alone

`settleSelection(statCount, gameIsFinal)` only returns `correct`/`incorrect` once
`gameIsFinal` is true, and even then it reads the actual `tries`/`goals` count — a
finished-but-scoreless player is `incorrect`, not skipped or guessed. A game being
"completed" never by itself implies a player was correct.

### Settlement safety (immutability — unchanged from Stage 8, re-verified this phase)

Once a selection's *stored* result is `correct` or `incorrect`, `settleEntrySelections`
never recomputes it, no matter what `player_game_stats` says on a later read — see the
dedicated test "a selection already settled (correct/incorrect) is never recomputed from
live stats". A future provider correction to a final game's stats requires an explicit
administrative action (not built — genuinely future work), never an accidental side effect
of a normal settlement run.

### Winner determination

`determineWinners(entries)` (`src/lib/perfect2/settle.ts`) — a winner is simply any entry
with `result === "perfect"`. Zero perfect entries → empty list. One → one winner. Many →
all of them, unranked, un-tie-broken, un-scored. The function's return shape is exactly
`{ winnerEntryIds, winnerCount }` — nothing else.

### Prize display, not distribution

`competitions.prizeAmountCents` (unchanged column) is read and formatted (never
hardcoded — `formatAudCents`, new this phase) on the results page. The results layer
exposes prize amount, entrant/perfect/pending/not-perfect counts, and the perfect entry
IDs — and stops there. No split/first-place/consolation logic was written; the brief
explicitly forbade inventing one.

---

## Phase 10 — Results, Competition Pages & Winners Experience

### Round page (`/[sport]/rounds/[roundId]`)

Now shows: sport + round name, entry fee and prize (both read from the competition row,
formatted via `formatAudCents` — never a hardcoded "$5"/"$60"), open/close times when
relevant, a `CompetitionStateBadge`, and a state-appropriate CTA: **Enter Perfect Play — $X**
when open, nothing actionable when not-yet-open/closed (the badge alone communicates it),
**View Results** when settled. A round with games but no competition row yet (nobody has
entered) is shown using the same default $5/$60 config a real row would get — this is a
display-only preview, not a database write; viewing a round never creates a competition
row, only submitting an entry does (`getCompetitionForRound` vs `getOrCreateCompetition`).

### Enter page (`/[sport]/rounds/[roundId]/enter`)

Unchanged eligibility model from Stage 6 (any player, any position, same-team or
cross-team combinations all allowed) — the position column is still shown for
*information*, never as a filter. New this phase: the page now checks the competition's
effective state server-side and refuses to render the picking form at all unless it's
actually `open`, showing a clear "not open"/"closed"/"settled" message with a link
elsewhere instead. This is on top of, not instead of, `createEntry`'s own server-side
check — the page-level gate is a UX courtesy, the action-level gate is the real lock.

### Entry review step (new this phase)

The selection form (`entry-form.tsx`) now has three steps — picking → review → submitted
— instead of submitting directly. The review step lists every game with the two selected
player names, restates "every selected player must achieve the required statistic, no
points are involved," and shows the entry fee before a final "Confirm entry" action.

### Entry confirmation

Explicitly states the competition, round, number of games entered, entry fee, and (if set)
when selections lock — plus an explicit, unambiguous line: **"Payment has not been
processed — this entry is not yet confirmed for the prize pool."** No fake payment
confirmation is shown anywhere.

### My Entry / entry results (`/[sport]/entries/[entryId]`, new this phase)

Per-game breakdown: teams, each selected player's name, their actual stat count phrased
naturally ("1 try", "0 goals" — `formatStatLabel`, sport-aware singular/plural, new this
phase), a `SelectionOutcomeBadge` (Pending/Correct/Incorrect) per player, and a
`PerfectResultBadge` (Pending/Perfect/Not Perfect) per game. The entry header uses the
exact three headings from the brief (`PERFECT` / `NOT PERFECT` / `PENDING`) with their
exact descriptions. No numeric score appears anywhere on this page.

### Competition results page (`/[sport]/rounds/[roundId]/results`, new this phase)

Shows sport, round, competition state, entrant/perfect/pending/not-perfect counts, and the
configured prize amount. Winners section: if not yet settled, says results aren't final
yet; if settled with zero perfect entries, says **"NO PERFECT ENTRIES"** verbatim; if
settled with one or more, lists them as **"Entry #N"** — never a ranked list, never a
"1st place."

### Privacy

No email address, real name, or any other personal identifier is ever displayed on the
results or winners UI — only the numeric entry ID (`Entry #42`). The app has no
display-name/handle system, so rather than inventing one, the safest existing identifier
(the entry's own primary key, which is already public-safe and meaningless outside this
app) was used, per the brief's explicit instruction not to invent new identity
infrastructure.

### Navigation

Round → Enter (when open) / Results (when settled) → Entry confirmation → My Entry →
back to Round or on to full Results. Every page states which sport and round it's showing
in its heading, and the round page explicitly states entering one sport never enters the
other ("This is a separate competition from AFL/NRL").

### Empty states

No demo data was created anywhere. With the database empty (verified before and after this
phase — still 12 tables, 0 rows), every route falls through to an honest empty state:
"No rounds scheduled yet," "No games scheduled yet," "No entries yet," "Results are not yet
available." Round/entry/game IDs that don't exist yield a real 404, not a fabricated page.

---

## Future

Explicitly not built this phase — genuine remaining work, not oversights:

- **Champion Data live credentials/API** — still not connected; nothing in this phase
  changed that (see `docs/stage8-sports-data-integration.md`).
- **Real sports-data sync** — the sync layer (Stage 8) is unused until a provider exists.
- **Authentication** — entries are still identified by a plain name/email upsert into
  `users`, no password/session. `competitionEntries.userId` already points at a real user
  row, so swapping in real auth later doesn't require a schema change.
- **Payment processing** — `paymentStatus`/`paidAmountCents` exist on entries and are
  always `pending`/`null`. No Stripe, no webhook, no charge anywhere.
- **Actual prize payouts** — the results layer exposes prize amount + perfect entry IDs
  and stops; no distribution formula (winner-takes-all, equal split, etc.) has been chosen
  or coded.
- **Production admin tools** — `closeCompetition`/`settleCompetition` are plain, callable
  functions with no UI. They're written so a future admin page or script can call them
  directly without any further backend work.
- **Automated cron/scheduling** — nothing calls `closeCompetition`/`settleCompetition`
  automatically yet. A competition past its `closesAt` is already treated as effectively
  closed for entry purposes (`getEffectiveCompetitionState`), but its stored `status`
  column won't flip to `"closed"` in the database until something actually calls
  `closeCompetition` — that trigger (cron, webhook, or admin action) doesn't exist yet.
- **Final commercial prize-distribution rules** — genuinely a business decision, not an
  engineering gap; deliberately left unresolved per instruction.
