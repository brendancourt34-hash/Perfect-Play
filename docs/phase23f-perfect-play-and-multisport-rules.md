# Phase 23F — Perfect Play rebrand + multi-sport rules update

## Summary

Two intertwined changes:

1. **Rebrand**: "Perfect 2" → "Perfect Play" across web, mobile, admin, and docs. The
   existing "P2" visual mark was initially preserved per the original brief, then
   explicitly replaced mid-phase with a new "PP" monogram (see "Logo" below) — the latter,
   more specific instruction supersedes the former.
2. **Rules overhaul**: every sport moved from "pick 2 players per game" to "pick the
   Perfect Round" — exactly 1 selection per game — plus AFL's round size (8→9), NBA's
   threshold (20+→25+ points), and a brand-new fourth sport, NFL.

Historical entries created before this phase (2 selections/game) are never rewritten or
reinterpreted — they remain fully readable and settle exactly as they always did, through
the same (now-generalized) engine.

## Rule changes by sport

| Sport | Games/round | Selections/game | Stat | Threshold | Changed this phase |
|---|---|---|---|---|---|
| NRL | 8 (unconstrained, recommended) | 1 (was 2) | tries | ≥1 | selections/game |
| AFL | 9 (unconstrained, recommended — was 8) | 1 (was 2) | goals | ≥1 | round size + selections/game |
| NBA | 8 (enforced, 2/day Thu–Sun) | 1 (was 2) | points | ≥25 (was ≥20) | threshold + selections/game |
| NFL | 8 (unconstrained, recommended) — **new sport** | 1 | touchdowns | ≥1 | new sport |

## Architecture

### Central rule config

`SportSelectionConfig` (`src/lib/perfect2/types.ts`) gained `selectionsPerGame`. Every
sport's config now lives in `src/lib/perfect2/rules/{nrl,afl,nba,nfl}.ts`, registered in
`src/lib/perfect2/registry.ts`. Round *shape* (game count/day structure) is a separate,
pre-existing concept in `src/lib/perfect2/round-shape.ts` — AFL's entry there moved from
`recommendedGamesPerRound: 8` to `9`; a new `nfl` entry mirrors NRL's unconstrained
pattern (admin curates from a much larger real weekly fixture).

The API exposes this server-authoritative config via `GET /api/[sport]/rounds/[roundId]`'s
new `ruleConfig: { sport, requiredGames, selectionsPerGame, selectionMetric, threshold }`
field, so mobile/web never hardcode sport rules independently.

### Schema — additive, non-destructive

- `entry_selections.selected_player_2_id` and `.player_2_result` were relaxed from
  `NOT NULL` to nullable (`scripts/migrate-phase23f-single-selection.ts`). Every entry
  created after this phase leaves them `null`; every entry created before keeps its real,
  original 2-pick data untouched and fully readable.
- `player_game_stats.touchdowns` was added (same dedicated-column treatment as
  tries/goals/points), defaulting to 0, additive only.

No table was renamed, no column was dropped, no historical row was rewritten.

### Settlement engine — generalized to N selections

`src/lib/perfect2/settle.ts`'s `settleGameSelection` now takes `readonly SelectionResult[]`
instead of a hardcoded pair — perfect iff every result is correct, not_perfect as soon as
any is incorrect, pending otherwise (identical logic, now sized to however many results a
game actually has). `settleEntrySelections`'s input/output shapes changed from fixed
`player1Id`/`player2Id` fields to a `selections: { playerId, storedResult }[]` array per
game. This is the single code path both a brand-new 1-pick NRL entry and a historical
2-pick AFL entry settle through — see `settle.test.ts`'s dedicated 2-selection describe
block proving historical entries are unaffected.

### Validation — generalized

`src/lib/selections/validate.ts`'s `validateSelection` now takes `playerIds: (number |
null | undefined)[]` plus an explicit `selectionsPerGame` (read from the sport's config at
the call site) instead of assuming exactly 2. Still validates: correct count, no
duplicates, every player eligible for that specific game (never position-restricted).

### Data layer / API contracts

`EntrySelectionInput` (`src/lib/data/entries.ts`) changed from `{gameId, player1Id,
player2Id}` to `{gameId, playerIds: number[]}`. `createEntry`/`purchaseEntryPackage` write
`selectedPlayer1Id = playerIds[0]`, `selectedPlayer2Id = playerIds[1] ?? null`. Every
consumer of the settled-result shape (`EntrySelectionSettlement`, admin's
`AdminEntrySelectionDetail`) was updated to a variable-length `selections[]` array (web
entry-result page, mobile entry-result screen, admin entry-detail page all iterate over it
rather than assuming exactly 2 named slots).

### NFL — new sport

Added end to end, mirroring the existing NRL/AFL pattern (never NBA's, which has a live
keyless ESPN default):

- `src/lib/sports/config.ts` / `mobile/constants/sports.ts` — `nfl` entry.
- `src/lib/perfect2/rules/nfl.ts` — touchdowns, threshold 1, selectionsPerGame 1.
- `src/lib/perfect2/round-shape.ts` — unconstrained, recommended 8.
- `src/lib/sports-data/config.ts` / `registry.ts` — `getNflSportsDataConfig`/
  `getNflSportsDataProvider`, defaulting to **"none" (honestly unconfigured)** — no real
  NFL data source has been vetted or connected; selecting "none" throws
  `SportsDataNotConfiguredError` rather than fabricating a connection. `mock-provider.ts`
  gained `createNflMockProvider()` (a small, NFL-flavored fixture, distinct from the
  NRL/AFL lifecycle fixture) for `NFL_SPORTS_DATA_PROVIDER=mock` dev/test use only.
- `src/app/(protected)/admin/nfl/page.tsx` (and mobile `app/(tabs)/nfl.tsx`) — new
  round-builder/tab screens, identical UX to NRL/AFL.
- `src/app/api/admin/rounds/{create,sync-provider-round}/route.ts` — provider resolution
  now branches on `sportCode` (`nba` → ESPN resolver, `nfl` → the new NFL resolver, else
  the NRL/AFL Champion Data resolver) so NFL never silently reuses another sport's provider
  status.
- Admin dashboard's "Sports data provider" box (`src/lib/data/admin.ts`) shows a third row,
  `"NFL (Unconfigured)"`, reflecting the real config — never fabricated.
- Cutoff/buy-in-lock logic was already fully generic (`computeFirstGameKickoff` derives the
  cutoff from whichever games are actually curated into a round) — no NFL-specific
  calendar/weekday logic was added or needed.

### Admin genericization

The Phase 23D refactor had already made the admin dashboard's entries/payments/commercial-
economics aggregation registry-driven (`SPORTS` from `src/lib/sports/config.ts`), so NFL
appeared automatically in the Sport Economics table, competitions list, and results/data-
readiness sections with no further code change. The round-builder (`RoundBuilder`
component) now also renders a human-readable rule summary line (e.g. "8 games • 1
touchdown scorer per game") computed from the sport's real config, for all four sports.

## Rebrand

- Repo-wide "Perfect 2"/"PERFECT 2" → "Perfect Play"/"PERFECT PLAY" across `src/`,
  `mobile/`, `docs/`, and `README.md` (mechanical, verified no false-positive matches).
- `mobile/app.json`'s human-readable `name` updated to "Perfect Play"; `slug`, `scheme`,
  `bundleIdentifier`, and the Android `package` were deliberately left unchanged (renaming
  these is a destructive, breaking change to deep links / app-store identity, explicitly
  out of scope).
- **Logo**: initially instructed to keep the existing "P2" mark unchanged; superseded
  mid-phase by an explicit instruction to replace it with a new two-glyph "PP" monogram (an
  upright italic "P" interlocked with the same glyph rotated 180° about its own stem
  center, guaranteeing an exact, provably-symmetric match rather than an arbitrary rotated
  letter). Implemented as a single shared SVG path
  (`src/components/pp-mark.tsx` for web, `mobile/components/PPMark.tsx` for mobile via the
  newly-added `react-native-svg` dependency, and inlined into `src/app/icon.tsx` /
  `apple-icon.tsx` for the web favicon/apple-touch-icon via Next's `ImageResponse`) so the
  glyph geometry is defined once and stays pixel-consistent everywhere it's used: web
  navbar, admin login/sidebar, mobile `Logo` component (home/account/login/registration/
  loading states, wherever the existing `Logo` component was already used).
- **Not implemented**: the mobile app icon, splash screen, and Android adaptive-icon
  assets remain the old raster PNGs (`mobile/assets/*.png`) — these are binary image files
  consumed directly by Expo's native build pipeline, and this session has no image-
  rasterization capability. Regenerating them from the new PP mark at the exact required
  pixel dimensions is flagged as a follow-up requiring a designer or image-export tool.

## Customer-facing messaging standard

Applied consistently across web and mobile: **PERFECT PLAY / PICK THE PERFECT ROUND / GET
EVERY PICK RIGHT / GO PERFECT / TAKE THE ENTIRE POOL**; multi-winner: "split the pool
evenly"; no-winner: "the pool rolls over to next round." Per-sport instruction lines: "Pick
a try scorer in every game." (NRL), "...goal scorer..." (AFL), "...player to score 25+
points..." (NBA), "...touchdown scorer..." (NFL), each paired with "Get every pick right to
go PERFECT." Old "pick 2"/"both correct"/"2/2" phrasing was removed from every
customer-facing surface (home, entry creation, review/confirmation, results, how-it-works,
registration) while technical/internal comments retain historical references for context.

## Testing

- **Unit**: `settle.test.ts` (rewritten — 1-selection describe blocks for the current
  model, a dedicated 2-selection describe block proving historical entries are unaffected,
  dynamic-round-size tests extended to 9 games for AFL), `validate.test.ts` (rewritten,
  same split), `registry.test.ts` (extended — all 4 sports' stat/threshold/
  selectionsPerGame asserted), `round-shape.test.ts` (extended — AFL's 8→9, new NFL
  coverage), `admin.test.ts` (updated registry-default expectation to include NFL).
- **Live QA**: `scripts/qa-phase23f-perfect-play-rules.ts` — 26 checks against the real
  running server: rule-config exposure, 2-pick submission rejected under the new model, a
  correct 1-pick NRL entry settling PERFECT, NBA's 24-points-now-incorrect threshold
  change, a full NFL entry created/settled end to end, a simulated historical 2-pick AFL
  entry still settling correctly through the same engine, and a rebrand spot-check on
  real page HTML.
- **Full regression**: backend `tsc --noEmit` clean, mobile `tsc --noEmit` clean, `eslint .`
  clean (12 pre-existing unrelated warnings only), `vitest run` 253/253 passing, `next
  build` succeeded with `/nfl`, `/admin/nfl`, `/icon`, `/apple-icon` all present in the
  route manifest.

## Explicitly not done (future work)

- Mobile app-icon/splash/adaptive-icon raster regeneration (see Logo section above).
- A real, connected NFL sports-data provider (config/abstraction exists; "none" is the
  honest default).
- Any change to payment processing, wallet, prize-pool/rollover settlement math, or
  commercial-economics modeling — all explicitly preserved untouched.
