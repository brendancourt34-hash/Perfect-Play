# Perfect Play — Phase 21: Sports Data Pipeline + Round Lifecycle

**Status:** Implemented and verified. Champion Data is **not connected** — no real
credentials or API documentation exist yet. Everything in this phase works today against
the Mock Sports Data Provider, and is structurally ready for Champion Data once real
access is confirmed.
**Date:** 2026-09-05

---

## 1. What this phase is (and isn't)

Phase 21 builds the round-lifecycle and sports-data architecture around the buy-in
cutoff and prize-pool reveal — it does **not** connect a live sports-data feed, does
**not** invent any Champion Data endpoint/payload/credential, and does **not** change any
Perfect Play competition rule (still two separate NRL/AFL competitions, still any-2-players
per game, still tri-state pending/correct/incorrect results, still no points/leaderboard).

## 2. The critical round lifecycle

```
TEAM LISTS RELEASED → COMPETITION OPEN → USERS BUY IN → USERS PICK
    → FIRST GAME KICKOFF → BUY-IN CLOSED + PRIZE POOL PUBLIC
    → ROUND PLAYS → RESULTS INGESTED → COMPETITION SETTLED
```

The one authoritative cutoff instant driving both "buy-in closes" and "prize pool becomes
public" is **the round's first game kickoff** — never the last game, never an individual
user's first selected game, never a fixed clock time, and never anything the client
supplies.

### `computeFirstGameKickoff` / `hasFirstGameKickedOff`

`src/lib/competitions/lifecycle.ts` — the single canonical implementation, used by every
consumer (entry creation, the payment pre-flight route, both round API routes, the results
route, and the admin dashboard):

```ts
computeFirstGameKickoff(games: { kickoff: Date | null }[]): Date | null   // MIN(kickoff), ignoring games with no kickoff yet
hasFirstGameKickedOff(firstGameKickoff: Date | null, now = new Date()): boolean  // now >= firstGameKickoff
```

- Never relies on array order — `computeFirstGameKickoff` explicitly ignores input
  ordering and only compares timestamp values.
- Two games sharing the identical kickoff instant is well-defined: the cutoff is a *point
  in time*, not a reference to a specific game, so a tie changes nothing about the
  comparison.
- `>=` at the boundary: the exact kickoff instant already counts as "kicked off" —
  consistent with `isSelectionLocked`'s existing `<=` per-game lock semantics
  (`src/lib/selections/validate.ts`) and `getEffectiveCompetitionState`'s existing
  `now >= closesAt` semantics (`src/lib/competitions/lifecycle.ts`, Phase 9/10). All three
  treat the boundary identically.
- All comparisons are plain `Date`/UTC. Kickoffs are stored as `timestamptz` and always
  round-trip UTC-aware; Australian-timezone formatting happens only in the UI layer
  (`formatAuDateTime`), never in any comparison.

### A real bug this phase fixed

The payment pre-flight route (`POST /api/[sport]/rounds/[roundId]/payment`) called
`getOrCreateCompetition(...)` **without** a `closesAt` argument. If a user hit that route
before anyone had created an entry for the round, the competition row was created with
`closesAt: null` — meaning `canAcceptEntries`/`getEffectiveCompetitionState` would never
treat it as closed, and the buy-in cutoff would silently never be enforced for that
competition. Fixed by having the route fetch the round's games and compute
`firstGameKickoff` the same way `createEntry` already did — now both paths (and every
other place a competition might first be created) pass the same, correctly-computed
cutoff. `entries.ts`'s own inline sort-based "earliest kickoff" logic was also replaced
with a call to the same shared `computeFirstGameKickoff`, so there is exactly one
implementation of "first game of the round" in the codebase.

## 3. Prize-pool visibility

New, strictly server-decided customer-facing rule: **the prize pool amount is never
returned in an API response before the round's first game kicks off** — not hidden by the
client, not `0`, but genuinely `null` in the payload, with a `prizePoolVisible: boolean`
flag alongside it.

Applied to every customer-facing endpoint that could otherwise leak it:
- `GET /api/[sport]/rounds` (list) — per round, inside the `competition` object.
- `GET /api/[sport]/rounds/[roundId]` (detail).
- `GET /api/[sport]/rounds/[roundId]/results` — defense in depth; in practice this
  endpoint is only reachable through the UI once a competition is `settled` (long after
  kickoff), but the server never assumes a client won't call it directly.

Response shape (identical field names across all three):

```json
{
  "prizePoolVisible": false,
  "currentPrizePoolCents": null,
  "firstGameKickoffAt": "2026-09-05T09:00:00.000Z",
  "buyInCutoffAt": "2026-09-05T09:00:00.000Z"
}
```

`firstGameKickoffAt` and `buyInCutoffAt` are always the same value — both are exposed
because the API-shape brief for this phase named them separately; internally they're
computed once and reused. Phase 19's prize calculation (`prizeAmountCents +
rolloverInCents`) is completely unchanged — this phase only decides *whether* to include
it in a given response, never how it's computed.

The admin dashboard is **not** subject to this gate — `currentPrizePoolCents` is always
shown there (it's an internal, authenticated, non-customer-facing view), alongside a
separate `prizePoolVisible` field that reports whether the *public* API is currently
showing it. Two different questions, both answered.

### Mobile

- `SportRoundListScreen` and the round-detail screen now render "Prize revealed at
  kickoff" instead of an amount when `prizePoolVisible` is false, and the real amount
  otherwise — never `prizeAmountCents` as a stand-in.
- Home screen (`app/(tabs)/index.tsx`): each sport's card now shows its nearest
  upcoming/open round's entry fee and pool line (`SportEntryCard`), gated the same way.
  NRL and AFL are fetched, computed, and rendered completely independently — one sport's
  round state never affects the other's card. The pool amount always comes from the
  server response; nothing is hardcoded.

## 4. Sports-data architecture (audited, mostly pre-existing from Stage 8)

```
External Provider → Provider Adapter (SportsDataProvider) → Normalized types (types.ts)
   → sync.ts (idempotent upserts) → Postgres → readiness.ts / settlement
```

- `src/lib/sports-data/provider.ts` — the `SportsDataProvider` interface
  (`listSeasons/listRounds/listTeams/listPlayers/listGames/listGamePlayers/listPlayerGameStats`)
  was already exactly what Phase 21 needed; unchanged.
- `src/lib/sports-data/sync.ts` — idempotent upserts keyed on each table's `externalId`
  (or the natural `(gameId, playerId)` constraint for lineups/stats) already existed from
  Stage 8 and already satisfied "repeated syncs must be safe" / "don't create duplicate
  records." Unchanged.
- `src/lib/sports-data/validate.ts` — pre-write data-quality checks (duplicate provider
  IDs, missing team/player, same team on both sides of a game) already existed. Unchanged.
- `src/lib/sports-data/status.ts` — maps a provider's raw status strings onto Perfect Play's
  existing 3-value `scheduled|live|final` vocabulary, throwing on anything unmapped rather
  than guessing. Already existed. Unchanged — no new game-status values were added; the
  existing 3-state model (matching `schema.gameStatusValues`) is what Perfect Play already
  uses everywhere, and settlement never uses status alone to decide an outcome (it uses
  the game being `final` plus real synced stats).

## 5. Champion Data — still not connected

`src/lib/sports-data/providers/champion-data-provider.ts` is unchanged from Stage 8: its
constructor throws `NotYetAvailableError` immediately, every method throws, and no method
body makes a network call, assumes an authentication scheme, or fabricates a response
shape. Nothing in Phase 21 invents an endpoint, payload, header, or credential for
Champion Data. It remains exactly what it was: the correctly-typed *location* a real
adapter will fill in once Perfect Play has actual API documentation and credentials.

### New: `getSportsDataProvider()` registry (mirrors the Phase 20 payments registry)

`src/lib/sports-data/config.ts` + `registry.ts`:

| `SPORTS_DATA_PROVIDER` | Result |
| --- | --- |
| unset / `none` (default) | `getSportsDataProvider()` throws `SportsDataNotConfiguredError` — no provider to sync from |
| `champion-data` | Returns a real `ChampionDataProvider` — which itself throws immediately, since no credentials exist |
| `mock` | Returns the Phase 21 lifecycle mock fixture (`createLifecycleMockProvider`) — an explicit, clearly-labelled dev/test opt-in, never selected by default |

A misconfiguration is always loud (a thrown error), never a silent fallback to fabricated
data — the same principle Phase 20 established for payments.

## 6. Mock Sports Data Provider — improved for the full lifecycle

`createMockProvider()` (the original, minimal, single-game NRL fixture) is **untouched** —
its existing tests still pass unmodified. A new, additive factory,
`createLifecycleMockProvider(options?)`, was added alongside it in the same file:

- Covers **both** NRL and AFL, each with its own season/round/4 teams/4 games.
- Kickoffs are staggered and computed relative to an injectable `referenceTime` (defaults
  to `new Date()`), so the fixture never silently becomes "a round from the past" as real
  time moves on.
- One deterministic snapshot represents every lifecycle stage at once: game 1 `final`
  (with real try/goal stats), game 2 `live`, games 3–4 `scheduled` — so "completed games"
  and "remaining games" are both exercised without needing multiple fixtures.
- A `teamListsReleased` option (default `true`): when `false`, `listGamePlayers()` returns
  an empty array for every game — the "games exist but no team list yet" readiness state.
  `listPlayers()` (team squads) is unaffected by this flag, matching the real-world
  distinction between "a player's general squad membership is known" and "the specific
  game-day team list has been officially released."
- NRL stats use `tries`, AFL stats use `goals` — never mixed, never any other stat.

This is the **one deliberate exception** to "the mock provider is test-only, never
imported by application code": `getSportsDataProvider()` can return it, but only when an
operator explicitly sets `SPORTS_DATA_PROVIDER=mock`. It is never selected by default, and
its `.name` (`"mock-lifecycle"`) is always visible in sync summaries so nobody mistakes it
for a real feed.

## 7. Sync orchestration

`src/lib/sports-data/orchestrate.ts` — `runFullSync(provider, sportCode, seasonExternalId,
roundExternalId)` chains the existing sync functions in the documented order (season →
teams → players → rounds → games → game-player associations → stats) for one sport's one
round. This is the "architecture for future scheduled synchronization" — a plain function
any caller can invoke (a Vercel Cron handler, an external scheduler, or today's admin
manual sync action) without requiring an actual cron provider to exist yet. Running it
twice never duplicates data — proven in the Phase 21 QA script by asserting the second run
is 100% updates, zero inserts.

### Admin manual sync — `POST /api/admin/sports-data/sync`

Admin-only (`requireAdmin`). Body: `{ sportCode, seasonExternalId, roundExternalId }`.
This is **not** a fake "Champion Data sync" button implying a live integration — it calls
`getSportsDataProvider()` and runs the real pipeline against whatever that actually
resolves to: a clear `503` if unconfigured, an immediate failure if `champion-data` is
selected (no real credentials), or a genuine sync against the labelled mock fixture if
`mock` is explicitly configured. Every outcome is logged via the existing
`logAdminAction` helper.

## 8. Round readiness — extended, not replaced

`getRoundReadiness(roundId)` (`src/lib/sports-data/readiness.ts`) already answered one
question (Phase 18): *is there enough real data to settle this round honestly once it's
over* (`ready`/`gamesReady`/`hasStatsIfFinal`). Phase 21 asks a different, earlier
question — *is there enough real data to let a customer select players for this round at
all* — and answers it with **new, additive fields** rather than repurposing the existing
ones (the settle-gating logic and its QA coverage depend on those staying exactly as they
were):

```ts
interface RoundReadiness {
  // unchanged (Phase 18, settlement readiness):
  roundId, gamesTotal, gamesReady, ready, games, issues;
  // new (Phase 21, selection/team-list readiness):
  teamListsReady: boolean;
  blockers: ReadinessBlockerCode[];
  firstGameKickoffAt: Date | null;
}
type ReadinessBlockerCode =
  | "NO_GAMES" | "MISSING_KICKOFF" | "MISSING_HOME_TEAM"
  | "MISSING_AWAY_TEAM" | "MISSING_PLAYERS" | "INCOMPLETE_GAME_PLAYER_DATA";
```

Per-game, `teamListReady` requires a known kickoff **and** at least 2 associated players
(the minimum the any-2-players mechanic needs to even be satisfiable) — position and
starting status are never checked or restricted anywhere in this logic.
`MISSING_HOME_TEAM`/`MISSING_AWAY_TEAM` are included for completeness per the spec but, in
this schema, can never actually fire: `games.home_team_id`/`away_team_id` are `NOT NULL`
foreign keys, so a game can't be synced without both teams already existing
(`syncGames` in `sync.ts` refuses to create the row otherwise) — they're still checked
defensively rather than assumed.

## 9. Admin dashboard additions

- Dashboard: a new "Sports data provider" card showing the real configured status (`Not
  configured` / `Mock (dev/test fixture — not real data)` / `Champion Data (not yet
  connected...)`).
- Competitions list + detail: first-game kickoff, buy-in cutoff, team-list readiness
  (with blocker codes), whether the public prize pool is currently visible, and
  games-with-complete-player-lists vs. total. `currentPrizePoolCents` remains always
  visible here (internal view) regardless of `prizePoolVisible`.
- Per-game rows in the competition detail page show their own `teamListReady` status and
  blockers alongside the existing settlement-readiness warnings.
- No manual "mark as ready" or fabricated sync-success control exists anywhere.

## 10. Time handling

- Every kickoff/cutoff timestamp is `timestamptz` in Postgres and a UTC-aware `Date` in
  application code — comparisons are always `Date#getTime()` numeric comparisons, never
  string comparison of formatted local times.
- `formatAuDateTime` (Australian-timezone display) is a presentation-layer concern only —
  it never participates in any cutoff/visibility decision.
- The one boundary rule used everywhere consistently: `now >= cutoff` means "already
  passed." Verified by a dedicated unit test at the exact instant
  (`hasFirstGameKickedOff(now, now) === true`, `src/lib/competitions/lifecycle.test.ts`).

## 11. Testing

- **Unit** (pure, no DB): `computeFirstGameKickoff`/`hasFirstGameKickedOff` (ties, nulls,
  out-of-order input, the exact boundary instant); `getSportsDataConfig`/
  `getSportsDataProvider` (default-off, explicit opt-ins, misconfiguration); the new
  lifecycle mock provider's shape (both sports, staggered kickoffs, status mix,
  `teamListsReleased` toggle, stats scoped to the right sport/stat field).
- **Integration** (`scripts/qa-phase21-lifecycle.ts`, real HTTP + real dev DB, full
  cleanup with zero-row verification): buy-in allowed before / rejected at-and-after the
  first kickoff; a later game's future kickoff never reopens buy-in; prize pool hidden
  before / visible after kickoff on both list and detail endpoints; NRL and AFL pool
  visibility fully independent; rollover correctly reflected once visible; client-forged
  `prizePoolVisible`/`currentPrizePoolCents`/`amountCents`/`closesAt`/`competitionStatus`
  all ignored; admin readiness/lifecycle fields; readiness reason codes transitioning from
  blocked to ready as data is completed; an association for a never-synced game rejected
  with a clear error; running the full sync pipeline twice produces zero duplicate rows on
  the second pass.
- The exact `now === kickoff` boundary is proven at the unit level (§10) rather than
  re-attempted over real HTTP timing, which can't reliably land on an exact instant.

## 12. Regression

Phases 16, 17, 18, 19, and 20's QA scripts were all re-run after these changes and all
still pass in full, confirming: the buy-in flow, the dev-only payment simulator, the admin
dashboard's existing sections, the prize/rollover engine, and entry immutability are all
unaffected.

## 13. What's still needed before real sports data

1. Champion Data (or an alternative) confirms commercial terms and supplies real API
   documentation and credentials.
2. A real `ChampionDataProvider` implementation is written against that actual documented
   contract — no call site changes, since everything already speaks the
   `SportsDataProvider` interface.
3. `SPORTS_DATA_PROVIDER=champion-data` is set in the server environment.
4. A real scheduler (Vercel Cron or equivalent) is wired to call `runFullSync` (or the
   admin sync route) on the pre-round / at-kickoff / during-round / after-games cadence
   already documented in §2 — the functions exist and are idempotent; only the trigger is
   missing.

Until all four of those happen, Perfect Play continues to run entirely on the Mock Sports
Data Provider, exactly as it does today.
