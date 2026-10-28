# Perfect Play — Stage 7: Full Product Architecture Audit

**Status:** Audit + necessary safe schema correction only. No sports-data connection, payments,
auth, or fake data were added.
**Date:** 2026-09-04

---

## 1. Executive summary

**Yes, aligned — with one real gap found and fixed during this audit.** Stage 6 had already
removed every trace of the old winger-restricted, points-based model from application code, UI
copy, and documentation. A full re-sweep for `winger`, `4 players`, `2 of 4`, `points`,
`leaderboard`, `fantasy`, `key forward`, `position eligibility`, and "combined NRL/AFL" turned up
**zero functional violations** — every remaining match was intentional explanatory text (e.g.
"there is no points system") or a data *value* like `position: "Winger"` that's still stored and
displayed for a player, just never used to restrict selection.

The one substantive gap: the brief requires each competition to directly carry **sport, season,
round, entry fee, prize amount, status, opening/closing time, and result status**. Stage 6's
`competitions` table was a persistent one-row-per-sport container with the round only on
`competition_entries` — that doesn't match "each competition has a round" and had no status or
timing fields at all. This has been corrected during this audit (see §3, §4) — `competitions` is
now one row per (sport, round), carrying `status`, `opensAt`, and `closesAt` directly, with
`competition_entries` simplified accordingly. The database was empty throughout (verified before
and after), so this was a zero-risk structural correction, not a data migration.

---

## 2. Problems found

| # | Problem | Where | Severity |
|---|---|---|---|
| 1 | `competitions` had no `roundId`, `status`, `opensAt`, or `closesAt` — didn't match the required "sport, season, round, entry fee, prize, status, opening/closing time, result status" shape. | `src/db/schema.ts` | Real gap — fixed this stage |
| 2 | `competition_entries.roundId` duplicated the round now available via `competition -> round`, and its 3-column unique constraint became redundant once competitions were per-round. | `src/db/schema.ts` | Consequence of #1 — fixed alongside it |
| 3 | Homepage sport-preview cards showed the $5/rule-summary text in small muted copy, not a visually prominent "$5 · separate competition" signal — risk that a user skims past it and assumes one combined entry. | `src/app/page.tsx` | Minor — polished this stage |
| 4 | Everything else audited (calculation engine, validation, routes, forms, tests, `.env.example`, `drizzle.config.ts`) — **no problems found.** | — | — |

No instances were found of: fake/seeded data, hardcoded `500`/`6000`-cent values in logic (both
only appear as schema column *defaults*, which is the correct place for a configurable default),
position-based selection filtering, a leaderboard/ranking table or UI, or NRL/AFL data mixing
anywhere in a query, type, or component.

---

## 3. Required changes

### MUST FIX NOW — done this stage
- Restructure `competitions` to be per-(sport, round) and carry `status` (`open|closed|settled`),
  `opensAt`, `closesAt`. Restructure `competition_entries` to drop the now-redundant `roundId`
  and simplify its unique constraint to `(competitionId, userId)`. Applied to the live (still
  empty) Neon database; `src/lib/data/competitions.ts` and `src/lib/data/entries.ts` updated to
  match; `createEntry` now also rejects entries against a competition whose `status !== "open"`.

### SHOULD FIX BEFORE DATA INTEGRATION
- None found that are blocking. The homepage visual-separation polish (problem #3) was low-risk
  enough to fix immediately rather than defer (see §6).
- Worth deciding before data integration, not code changes: who/what transitions
  `competitions.status` from `open` → `closed` → `settled`, and who sets `opensAt`/`closesAt`
  beyond the automatic default (`closesAt` is currently set once, at competition-creation time,
  from the round's earliest kickoff — see §4). A scheduled job is the natural owner once a data
  sync exists, but that's Stage 8+ scope, not a Stage 7 gap.

### FUTURE (explicitly out of scope per this stage's brief)
- Payment processing (Stripe or otherwise), payout/withdrawal logic.
- Real authentication (current entry form does name+email → `users` upsert, no session/password).
- A results/winners summary page (total entries, Perfect entries, pending, winners, prize amount
  — the brief explicitly says not to invent ranking rules here, only to confirm the *data* to
  support it exists, which it does — see §7).
- Sports-data sync service (blocked on Champion Data's response, per Stage 4).

---

## 4. Database assessment

**Appropriate, and now fully matches the required shape.** Current hierarchy:

```
Sport → Season → Round → Game → (Teams, Player, Player Game Stats, Game Lineup)
Sport + Round → Competition → Competition Entry → Entry Selection (2 players/game) →
  per-selection result → overall entry result
```

`competitions` now carries every field the brief requires directly on the row: `sportId`,
`roundId` (season is intentionally *not* duplicated — it's one join away via
`roundId → rounds.seasonId`, avoiding a second source of truth that could drift),
`entryFeeCents` (default 500 = $5), `prizeAmountCents` (default 6000 = $60), `status`
(`open|closed|settled`), `opensAt`, `closesAt`. Both dollar figures are plain configurable data
columns — nothing in `src/lib/perfect2/` or `src/lib/data/` ever hardcodes 500 or 6000; the
settlement engine doesn't reference money at all, and the UI reads `competition.entryFeeCents`
wherever the $5 figure is shown (currently still a static "$5" label pending the competition
actually being loaded on those pages — noted as a UI follow-up, not a data-model gap).

`competition_entries` is now a clean child of `competitions` (`competitionId`, `userId`, unique
together — one entry per user per competition-round instance), with `paymentStatus`
(`pending|paid|refunded`, unused until Stage 8+) and the tri-state `result`.

`entry_selections` is unchanged from Stage 6 and was already correct: one row per game per entry,
two player FKs, two tri-state per-player results, unique on `(entryId, gameId)` — which is exactly
how "exactly two selections per game, one row per game" is enforced at the database level, not
just in application code.

**Extensibility:** adding a new sport is registry + one row in `sports` + one `SportSelectionConfig`
— no schema change. Adding a new round is a new `rounds` row plus a new `competitions` row (created
lazily via `getOrCreateCompetition` the first time someone enters that round) — no schema change.
Multiple seasons are already supported (`seasons.sportId + year`, unique) with no design changes
needed for next year's season.

---

## 5. Competition separation assessment

**Confirmed. NRL and AFL cannot become mixed, structurally, not just by convention.**

- `competitions.sportId` is `NOT NULL` with a foreign key to `sports` — every competition row
  belongs to exactly one sport. There is no schema path for a competition to reference both NRL
  and AFL.
- `competitions_sport_round_unique` (`sportId`, `roundId`) means NRL Round 5 and AFL Round 5 are
  necessarily two different `competitions` rows — the database physically cannot represent "one
  competition for both."
- A `competition_entries` row references exactly one `competitionId`, so a user's NRL entry and
  AFL entry are always two separate rows, each traceable to exactly one sport through its
  competition. There is no join path from an NRL entry to an AFL result or vice versa.
- Verified in code: `getSelectionConfig("nrl")` and `getSelectionConfig("afl")` return distinct
  objects (`statField: "tries"` vs `"goals"`); a unit test (`registry.test.ts`) asserts they're
  never `===` and that requesting `"combined"` throws rather than falling back to a shared config.
- A user entering both pays for two separate `competition_entries` rows against two separate
  `competitions` rows — the $10-for-both framing in the brief falls directly out of "$5 per
  competition, enter as many as you like," with no special-cased "combo" logic anywhere.

---

## 6. Selection assessment

**Confirmed — any-two-player model, no position filtering, enforced at both the UI and the
validation layer.**

- `game_lineups` (unchanged from Stage 1) lists every player who took the field for a specific
  game, starting or interchange, with no eligibility gate beyond "were they in this game." That's
  the entire eligible-player pool.
- `listEligiblePlayersForRound` (`src/lib/data/games.ts`) returns every one of those players per
  game — no `WHERE position = ...` filter anywhere in the query.
- The selection UI (`entry-form.tsx`) renders every eligible player from *either* team in a plain
  `<select>` per pick slot — same-team pairs, different-team pairs, forwards, backs, wingers,
  bench players are all equally selectable. There is no position-based grouping, filtering, or
  hidden subset.
- `validateSelection` (`src/lib/selections/validate.ts`) checks exactly the required rules and
  nothing more: both players present (`errors: "Exactly 2 players must be selected"`), different
  from each other, and each present in that specific game's eligible set — no position check
  exists in the function at all. Verified by unit tests: same-team pair passes, different-team
  pair passes, a player from another game is rejected, a duplicate pick is rejected, a missing
  pick is rejected.
- `validateEntrySelections` additionally confirms every game in the round has exactly one
  selection and no selection references a game outside the round — covering "incomplete
  selections rejected" at the whole-entry level, not just per-game.
- Locking: `isSelectionLocked` derives from the game's own `status`/`kickoff`, not a separate
  flag, and `createEntry` rejects the whole entry if *any* of its games has already locked —
  selections are immutable after a game starts because there is no code path to update
  `entry_selections` after creation at all (only `getEntryWithResult` writes to it, and only the
  two `*Result` columns, never the selected player IDs).

---

## 7. Settlement assessment

**Confirmed — exactly the binary model, verified by 31 passing unit tests, no numeric scoring
anywhere.**

`src/lib/perfect2/settle.ts` — three pure functions:

- `settleSelection(statCount, gameIsFinal)`: `pending` while not final; once final, `correct` if
  `statCount >= 1`, else `incorrect`. `statField` is `tries` for NRL, `goals` for AFL
  (`SportSelectionConfig`, one config object per sport, never shared).
- `settleGameSelection(player1Result, player2Result)`: `perfect` only if both `correct`;
  `not_perfect` as soon as either is `incorrect` (checked before pending, so a known failure
  isn't masked by the other pick still being undecided); `pending` otherwise.
- `settleEntry(gameResults)`: `perfect` only if every game is `perfect`; `not_perfect` as soon as
  any game is `not_perfect` (again checked first); `pending` otherwise, including when there are
  no games at all.

No function in this file, or anywhere else in the codebase, produces or consumes a numeric score.
The database columns backing these results (`entry_selections.player1Result`/`player2Result`,
`competition_entries.result`) are `varchar` typed to exactly the 3-value literal unions
(`selectionResultValues`, `entryResultValues` in `schema.ts`) — a test in `registry.test.ts`
asserts those value sets are exactly `["correct","incorrect","pending"]` and
`["not_perfect","perfect","pending"]`, nothing more.

---

## 8. Payment readiness

**Yes — the competition system does not need to be redesigned to add a $5 entry fee flow later.**

- `competitions.entryFeeCents` (default 500) already exists as a plain, configurable integer
  column, read at competition-creation time, never hardcoded in `src/lib/perfect2/` or
  `src/lib/data/`.
- `competition_entries.paymentStatus` (`pending|paid|refunded`) and `paidAmountCents` already
  exist on the entry row, currently always written as `pending`/`null` since no payment step
  runs. Wiring a real payment provider later means: collect payment before (or as part of)
  `createEntry`, then set `paymentStatus: "paid"` and `paidAmountCents` — no new tables, no
  change to the selection or settlement model, which are already payment-agnostic.
- `competitions.status` (`open|closed|settled`) is the natural gate for "stop accepting new
  entries" once a payment flow exists — `createEntry` already checks `competition.status ===
  "open"` and rejects otherwise, so a future scheduled job that flips a competition to `closed`
  at `closesAt` automatically stops new entries with no further code change.
- Nothing about "enter NRL for $5, AFL for $5, both for $10" requires special-casing: it's simply
  two independent `createEntry` calls against two independent competitions, each with its own
  `entryFeeCents`. There is no combined-checkout concept baked into the data model that would need
  unwinding.

---

## 9. Sports-data readiness

**The application currently has zero dependency on Champion Data or any external provider** —
confirmed by grep (no API client, no credentials, no `fetch` to an external sports-data host
anywhere in `src/`) and by the empty-database checks run before and after this stage's schema
changes (12 tables, 0 rows, every time). All pages already render the existing `DataUnavailable`
empty state rather than crashing or fabricating content when the relevant tables are empty.

What the eventual provider must supply, mapped directly to the current schema (unchanged from the
Stage 3/4 analysis, restated here for completeness against the *current* any-2-players model,
which is actually a **smaller** ask than the old starting-wingers rule):

| Needed | Schema target | Notes |
|---|---|---|
| Games, with round/date/venue/status/score | `games` | Unchanged requirement |
| Teams | `teams` | Unchanged requirement |
| **Every player who took part in a game** (not just starters) | `game_lineups` | No longer needs to distinguish "starting winger" specifically — any listed player, any position, is sufficient, since selection has no position restriction |
| Stable player ID across games/seasons | `players.externalId` | Unchanged requirement — still critical for `entry_selections` to reference the right player consistently |
| Try count per player per game (NRL) | `player_game_stats.tries` | Unchanged requirement |
| Goal count per player per game (AFL) | `player_game_stats.goals` | Unchanged requirement |

The data requirement is **simpler than before**: Stage 3/4's research was scoped around needing
provider confidence in "who actually started at winger," a fairly demanding ask. The current
model only needs "who took part in this game" (any position) plus try/goal counts — a lower bar
that most of the Stage 3 candidate providers likely clear more easily, though that's worth
revisiting once Champion Data (or another provider) actually responds, rather than assumed here.

---

## 10. Final verdict

**READY FOR DATA INTEGRATION.**

The one real structural gap this audit found (`competitions` missing round/status/timing fields)
has been fixed, applied to the live database, and verified — all 12 tables present, correct FKs,
zero rows. Lint, the full 31-test unit suite, and the production build all pass. The competition
model cleanly separates NRL and AFL at the schema level (not just by convention), the any-2-player
selection model has no position restriction anywhere from the database up through the UI, and
settlement is a strictly binary/tri-state model with no points, scoring, or ranking in sight. The
architecture does not need to change shape to add a sports-data sync, a payment flow, or real
authentication later — each of those is additive against the current schema, not a redesign.
