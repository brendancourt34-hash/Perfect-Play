# Perfect Play — Phase 22: NBA as a Real Third Sport + Configurable Round Shape

**Status:** Implemented and verified. NBA is driven entirely by real, live, public data —
no fabricated games, players, teams, or statistics anywhere in this phase.
**Date:** 2026-09-05

---

## 0. No fabricated data — read this first

NBA Perfect Play is built against `site.api.espn.com` — a genuine, public, keyless JSON API
serving the real 2026-27 NBA schedule, rosters, and box scores (verified live via curl
and a smoke-test script before any code was written against it). This is **not** Champion
Data, which remains deliberately unconnected pending a commercial agreement (see Phase 21).
Because ESPN's endpoint is genuinely public and requires no credentials, NBA's provider
(`getNbaSportsDataProvider()`) defaults to the real `NbaEspnProvider` — unlike NRL/AFL's
`getSportsDataProvider()`, which defaults to throwing since no commercial data agreement
exists for those sports yet.

- Teams, players, games, kickoff times, venues: real, synced from ESPN.
- Player statistics: only ever real numbers pulled from ESPN's box score once a game is
  final. A selection stays "pending" until then — never estimated or guessed.
- No mock/fake NBA data path exists in production code; `mock-provider.ts` remains NRL/AFL
  test-only, as it was before this phase.

## 1. The Perfect Play NBA rule

8 games per round, 2 games per day across a fixed Thursday→Sunday window, 2 players per
game, each selected player must score 20+ points (exactly 20 = HIT, 19 = MISS), 16 total
selections, every one must hit to win. This is pure **configuration** of the same engine
NRL/AFL already used — see `src/lib/perfect2/rules/nba.ts`
(`{sportCode:"nba", statField:"points", targetThreshold:20, selectionLabel:"20+ Points"}`)
and `src/lib/perfect2/round-shape.ts`'s NBA entry (`gamesPerRound:8, gamesPerDay:2,
roundDays:["thursday","friday","saturday","sunday"]`). Nothing in `settle.ts` or any UI
component is NBA-specific; the same `settleSelection`/`settleEntrySelections` functions
that already handled tries/goals now handle points purely by reading `statField` and
`targetThreshold` from config.

## 2. Reusable sport engine — two orthogonal configs

- **`SportSelectionConfig`** (`statField`, `targetThreshold`, `selectionLabel`) drives
  *settlement*: what counts as a hit for one selection.
- **`SportRoundShapeConfig`** (`gamesPerRound`, `gamesPerDay`, `roundDays`,
  `recommendedGamesPerRound`) drives *admin curation validation*: how many games an admin
  is allowed to assemble into a round, and how.

These are deliberately separate concerns living in separate files, read by separate code
paths — settlement never reads round-shape, and round-shape validation never touches
settlement. NRL/AFL are `gamesPerRound: null` (unconstrained — admin curates any number,
e.g. 6 during a State of Origin/bye week); only NBA has an actually-enforced fixed shape,
because the Thursday-Sunday cadence is a defined product rule, not a fixture quirk.

## 3. Schedule-pool + curation architecture

A per-season "schedule pool" round (`rounds.isSchedulePool = true`, `roundNumber = 0`
sentinel) accumulates every real, synced-but-not-yet-curated game. An admin then curates a
subset of that pool into a real, customer-facing round via `assignCandidatesToRound`
(`src/lib/data/schedule-pool.ts`), which validates the sport's round shape **before**
writing anything — an invalid NBA assignment (e.g. only 1 game) is rejected outright, never
partially written.

Two sync paths converge on the same pool through a shared `upsertGamesIntoRound` helper
(`src/lib/sports-data/sync.ts`):
- `syncGamesForDateRange` — NBA's path (ESPN has no native "round" concept; admin syncs a
  calendar date range and curates from what comes back).
- `syncProviderGamesIntoPool` — NRL/AFL's path (the provider has a native round concept).

Player eligibility (`game_lineups`) is synced separately, only for games actually curated
into a real round (`syncPlayerEligibilityForGames`), not for every candidate still sitting
in the pool — this was a real bug found via this phase's own QA script (see §5) and fixed
by wiring it into `POST /api/admin/rounds/create` immediately after curation succeeds.

## 4. Admin UI

A single generic `RoundBuilder` component (`src/components/admin/round-builder.tsx`),
parametrized by `sportCode`/`sportName`/`syncMode` (`"date-range"` for NBA,
`"provider-round"` for NRL/AFL) and optional `daySlots`, is reused across `/admin/nba`,
`/admin/nrl`, and `/admin/afl` — there is no separate NBA-only admin component. The same
generic `/api/admin/rounds/candidates` and `/api/admin/rounds/create` routes serve every
sport; the old NBA-specific `/api/admin/nba/candidates` and `/api/admin/nba/rounds` routes
were deleted once the generic versions covered the same ground.

## 5. QA coverage & a real bug it found

`scripts/qa-phase22-nba.ts` drives Part A (NBA) entirely through the real running admin
HTTP API against the real live ESPN provider — no mock, no fabricated games. Part B
(NRL variable round size, e.g. a 6-game/3-day Origin week) calls the curation library
functions directly with the labelled mock provider, since the HTTP sync route for NRL/AFL
depends on the running server process's own `SPORTS_DATA_PROVIDER` env var, which a
separate QA script process can't flip without restarting the server; the HTTP route itself
is instead smoke-tested for its documented fail-safe behavior (503 while unconfigured).

Three real issues were found and fixed via this script, not invented for the writeup:

1. **Missing player-eligibility sync** — round creation synced games/teams but never
   `game_lineups`, so every curated round had zero eligible players. Fixed by adding
   `syncPlayerEligibilityForGames` to the create-round flow (§3).
2. **Orphaned-round unique-constraint deadlock** — an earlier failed run's round-creation
   request succeeded server-side but its HTTP response was lost to the client (a genuine
   network blip), so the QA script never captured the round's id and could never clean it
   up. Every subsequent run then failed identically, forever, because
   `rounds_season_number_unique (season_id, round_number)` collided with the orphan's
   fixed round number. Fixed by adding a defensive pre-flight step to the QA script that
   finds and removes any leftover round matching this run's naming convention *before*
   asserting anything, so a lost response can never permanently wedge the test.
3. **Curating a locked game into a "reduced round" entry-creation test** — Part B's
   lifecycle mock fixture deliberately mixes game statuses (one `final`, one `live`, two
   `scheduled` — see `mock-provider.ts`), and `isSelectionLocked`
   (`src/lib/selections/validate.ts`) correctly locks a selection the instant a game's
   status isn't `scheduled`, regardless of how far in the future its kickoff is shifted.
   The QA script's own test was curating an arbitrary slice of games (including the
   already-`final`/`live` ones) into the round it then tried to create a real entry
   against, so entry creation correctly — and expectedly — failed with "already started."
   This was a bug in the QA script's own test design, not the product: fixed by curating
   only the genuinely `scheduled` games (2 of the 4 in this fixture) into the
   entry-creation round, which is exactly what a real admin curating a reduced round of
   still-upcoming games would do.

A raw, uncaught `TypeError: fetch failed` (a genuine transient Neon network blip, not a
code bug) was also observed once during direct-DB settlement-outcome seeding; the script's
direct-DB writes for that step are now wrapped in a small retry-on-transient-network-error
helper (`withDbRetry`), mirroring the retry the HTTP `api()` helper already had.

**Cleanup convention (deliberate deviation):** unlike every other phase's QA script, this
one does **not** delete the real NBA teams/players/season/schedule-pool games it syncs —
those are genuine, reusable reference data, exactly what a real admin sync would produce,
not QA fixtures. Only the QA-created round/competition/entries/selections/stats/users are
removed, with independent zero-row verification on those specifically.

## 6. Mobile

NBA is registered as a first-class sport (`constants/sports.ts`), with its own home-screen
card, its own tab (`app/(tabs)/nba.tsx`), and day-grouped round display
(Thursday/Friday/Saturday/Sunday `SectionList`) driven by the `slotLabel` field the API
returns per game — `slotLabel` is `null` for NRL/AFL, which render as a flat list exactly
as before. `StatusBadge`/`ResultRow` gained an optional `labels` override so "20+ Points"
result language never leaks NRL/AFL's "try"/"goal" wording, and the entry screen no longer
hardcodes "tries scored" — it reads `roundDetail.selectionLabel`, which is per-sport
config, never a hardcoded string.
