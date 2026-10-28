# Perfect Play — Stage 8: Sports Data Integration

**Status:** Abstraction, database, validation, and tests built. **No sports-data provider is
connected.** No credentials exist anywhere in this project.
**Date:** 2026-09-04

---

## 1. Current architecture

```
External Provider (none connected)
        │
        ▼
Provider Adapter — implements SportsDataProvider (src/lib/sports-data/provider.ts)
        │
        ▼
Normalized Perfect Play Sports Data — NormalizedSeason/Round/Game/Team/Player/
  GamePlayerAssociation/PlayerGameStat (src/lib/sports-data/types.ts)
        │
        ▼
sync.ts — idempotent Postgres upserts, keyed on each table's externalId
  (or the natural (gameId, playerId) key for lineups/stats)
        │
        ▼
Database — sports, seasons, rounds, games, teams, players, game_lineups,
  player_game_stats (unchanged tables from Stage 1, now with externalId sync keys)
        │
        ▼
Competition / Selection / Settlement (unchanged from Stage 6/7 —
  src/lib/perfect2/settle.ts, src/lib/data/entries.ts)
        │
        ▼
UI (unchanged — src/app/[sport]/...)
```

Nothing downstream of the normalized types has any notion of a specific provider. The
competition, selection, and settlement layers (Stage 6/7) are untouched by this stage —
they already only depend on `games`, `game_lineups`, and `player_game_stats`, which is
exactly what `sync.ts` populates.

---

## 2. Provider abstraction

`src/lib/sports-data/provider.ts` defines `SportsDataProvider`, a 6-method interface:
`listSeasons`, `listRounds`, `listTeams`, `listPlayers`, `listGames`, `listGamePlayers`,
`listPlayerGameStats`. Every method returns already-normalized data (`types.ts`) — a
provider adapter's entire job is translating its own API shape into these types; nothing
else in the app ever sees a provider's raw response.

Two implementations exist today:

- **`ChampionDataProvider`** (`providers/champion-data-provider.ts`) — a deliberate
  boundary placeholder. Its constructor throws immediately, and every method throws a
  `NotYetAvailableError` naming exactly which method is blocked. This is intentional: it
  marks *where* the real adapter will live without inventing an API shape, endpoint, or
  authentication scheme Champion Data hasn't documented.
- **`createMockProvider()`** (`providers/mock-provider.ts`) — a clearly-labelled,
  in-memory **test fixture**, used only by `*.test.ts` files. It's never imported by any
  route, server action, or script that touches the real database — it exists purely to
  prove the normalize → validate → settle pipeline works end to end without a real
  connection.

Adding a second commercial provider later (or a fallback) means writing one more class
implementing `SportsDataProvider` — no change to `sync.ts`, the database, or anything
above it.

---

## 3. Champion Data status

**NOT CONNECTED.**

- A commercial enquiry was submitted to Champion Data (Stage 4) requesting API
  documentation, credentials, licensing terms, and a sample historical NRL payload.
- **No response has been received.** No API documentation exists in this project. No
  endpoint, authentication method, or payload shape has been assumed or invented anywhere
  in this codebase.
- `ChampionDataProvider` is a non-functional placeholder that throws on every call — it
  does not send a single HTTP request to any Champion Data host.
- No Champion Data credentials, API keys, or secrets exist in `.env.example`, `.env.local`,
  or anywhere in source control.
- This stage did **not** contact Champion Data again, per instruction.

---

## 4. Required provider data

Exactly what Perfect Play needs — nothing more:

| Entity | Required fields |
|---|---|
| Season | provider season ID, sport, year/label |
| Round | provider round ID, season, round number/name |
| Game | provider game ID, sport, round, home team, away team, scheduled start time, status; ideally venue, completion time |
| Team | provider team ID, sport, name |
| Player | provider player ID, name, current team |
| Game-player association | which players (any position) were part of a specific game — this is the entire selection-eligibility pool |
| NRL stat | tries per player per game |
| AFL stat | goals per player per game |

Position is accepted and stored (`NormalizedPlayer.position`,
`NormalizedGamePlayerAssociation.position`) purely for informational/UI display — it is
never read by validation or settlement logic anywhere in the codebase (unchanged from the
Stage 7 audit finding).

---

## 5. Database mapping

No new tables were needed for sports data — Stage 1's schema already had the right shape.
Three small additive columns were added so every syncable entity has a stable idempotency
key:

| Table | Change | Why |
|---|---|---|
| `seasons` | added `external_id` (nullable, unique) | Wasn't previously syncable by provider ID at all |
| `rounds` | added `external_id` (nullable, unique) | Same |
| `teams` | `external_id` column already existed but had **no unique constraint** — added `teams_external_id_unique` | Without this, nothing stopped a re-sync from creating duplicate teams; now the database itself enforces one row per provider team ID |
| `games`, `players` | unchanged | Already had a unique `external_id` — this was already correct |
| `game_lineups`, `player_game_stats` | unchanged | Already uniquely keyed by `(gameId, playerId)`, which *is* the natural provider-agnostic identity for "this player's record for this game" |

Applied directly to the live (still empty) Neon database — verified before and after:
**12 tables, 0 rows in every one, 15 unique constraints** (up from 12).

`competitions`, `competition_entries`, `entry_selections` (Stage 6/7) were **not touched**
— they don't need provider data, only real game/player rows to reference.

---

## 6. Synchronisation

Every `sync*` function in `src/lib/sports-data/sync.ts` is a genuine Postgres
`INSERT ... ON CONFLICT (external_id) DO UPDATE` (or the composite-key equivalent for
lineups/stats) — **idempotency is a database guarantee, not an application-level
bookkeeping trick.** Running any sync function twice with identical input always results
in exactly one row per provider ID; the second run simply updates the first run's row.

Order matters and is enforced with explicit errors rather than silent skips:
`syncSeasons → syncRounds → syncTeams → syncPlayers → syncGames → syncGamePlayers →
syncPlayerGameStats`. Calling one out of order (e.g. `syncGames` before the round exists)
returns a `SyncSummary` with a clear error string, not a crash or a fabricated row.

Every sync function returns `{ inserted, updated, errors }` — nothing is silently
corrected or dropped; a malformed record (missing provider ID, a game without two teams, a
negative stat count, etc.) is caught by `validate.ts` and reported in `errors`, and that
one record is skipped rather than partially written.

**Not built this stage:** a scheduler/cron that calls these functions automatically, and
an admin UI to trigger a sync manually. Both are reasonable next additions once a real
provider exists to sync *from* — building them now would just be plumbing with nothing on
the other end.

---

## 7. Match statuses

`src/lib/sports-data/status.ts` exports `mapExternalGameStatus(externalStatus, mapping)`,
which maps an arbitrary provider status string onto Perfect Play's 3-value internal enum
(`scheduled | live | final`) via an explicit lookup table — and **throws** for any status
string not in that table, rather than guessing or defaulting.

`sync.ts` currently uses a `PLACEHOLDER_STATUS_MAPPING` (`{scheduled: "scheduled", live:
"live", final: "final"}`) — a 1:1 identity mapping used only by the mock provider's
already-normalized test fixture. **This is explicitly not modeled on Champion Data's real
status vocabulary**, which isn't known yet. Once API documentation exists, replace this
constant with Champion Data's actual status strings (e.g. whatever they use for
postponed/abandoned matches, if anything) — the function's fail-loudly behavior means an
incomplete mapping will surface immediately as a sync error instead of mis-tagging a game.

---

## 8. Historical data

The schema and sync functions are season/round agnostic — `syncSeasons` and `syncRounds`
work identically for the current season or a 2015 season; there's no "current season only"
assumption anywhere in this layer. Importing historical NRL/AFL data is the same
`syncSeasons → ... → syncPlayerGameStats` pipeline, just pointed at a historical season's
provider IDs.

**No historical data has been imported** — there is no data to import without a connected
provider, and none was fabricated. Per the Stage 3 research, exact historical depth
(2024/2025/2026+) is one of the open questions still awaiting Champion Data's response
(see §10).

---

## 9. Settlement relationship

**The settlement engine was not touched.** `src/lib/perfect2/settle.ts`'s three functions
(`settleSelection`, `settleGameSelection`, `settleEntry`) are exactly as they were at the
end of Stage 7 — `tries >= 1` / `goals >= 1` → correct, both correct → game perfect, every
game perfect → entry perfect, unchanged.

The sports-data layer's entire job is populating the two tables that engine already reads:
`games.status` (to know when to stop returning "pending") and `player_game_stats.tries` /
`.goals` (the actual counts). `syncPlayerGameStats` writes exactly those two columns and
nothing else — no new settlement input was introduced.

**Immutability fix made this stage:** `getEntryWithResult` (`src/lib/data/entries.ts`)
previously recomputed every selection's result from live stats on every read. That's fine
while a game is still in progress, but risky once a game is `final` and later corrected by
the provider (e.g. a try reassigned after video review) — a naive re-read would silently
flip an already-settled entry. The fix is a one-way latch: a selection is only
(re)evaluated while its stored result is still `"pending"`; once it's `"correct"` or
`"incorrect"`, `getEntryWithResult` never overwrites it again, no matter what
`player_game_stats` says later. This is the "simple, robust, not event-sourcing"
architecture the brief asked for — a settled selection is final by construction, not by an
audit log. A genuine correction (rare) would need an explicit future admin action, out of
scope here.

Also added this stage: `checkRoundDataReadiness()` (`src/lib/sports-data/readiness.ts`), a
read-only helper that reports whether every game in a round has a full lineup for both
teams — i.e. whether users *could* make a valid selection. It does not itself flip a
competition's `status`; that automation is future scope, per the brief's explicit "don't
implement the whole lifecycle this stage."

---

## 10. Open questions for Champion Data

Restated and refined from the Stage 4 enquiry now that the product model no longer needs
position-restricted lineups — still unanswered:

- **API availability**: is there a self-serve API, or only bilateral data-feed delivery?
- **Authentication**: API key, OAuth2, IP allowlisting — what does Champion Data actually use?
- **NRL coverage**: confirmed depth of per-game player-association and try-count data.
- **AFL coverage**: same, for goals.
- **Historical seasons**: exactly which years are available via API (2024/2025/2026+ confirmed?).
- **Upcoming/future fixtures**: how far ahead are unplayed rounds/games available?
- **Player-game data**: does the API expose "every player who played in this game" directly, or does it need to be derived from other endpoints?
- **Final player statistics**: how soon after full-time are try/goal counts finalized, and are they ever revised afterward?
- **Real-time/live updates**: push/webhook available, or polling only?
- **Match status vocabulary**: the exact set of status strings/codes Champion Data uses (needed to fill in the status mapping in §7).
- **Provider IDs**: are season/round/game/team/player IDs stable across seasons, or do they get reissued?
- **Rate limits**: request quotas, and whether historical backfill has a separate (higher) limit.
- **Commercial licensing**: confirmed terms for a public-facing paid prediction competition, not just editorial/analytics use.
- **Storage rights**: explicit permission to persist historical data in our own Postgres database.
- **Derived-data rights**: explicit permission to compute and store our own Perfect Play correct/incorrect/perfect results from their data.
- **Display rights**: any required attribution wording/placement.
- **Caching requirements**: any contractual limit on how long data may be cached/retained.
- **Webhook support**: as an alternative to polling for live status/stat changes.
- **Pricing**: startup/developer tier vs. enterprise-only, and whether NRL + AFL are priced together.
- **Sandbox/test access**: a trial environment or sample payload to validate the mapping in `sync.ts` before committing to a contract.

None of these have been assumed or guessed anywhere in this codebase — `ChampionDataProvider`
throws rather than answering any of them speculatively.
