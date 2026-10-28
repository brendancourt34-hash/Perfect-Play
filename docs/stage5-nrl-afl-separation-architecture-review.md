# Perfect Play — Stage 5: NRL/AFL Separation Architecture Review

**Status:** Review only. No schema, code, or data changed in this stage.
**Date:** 2026-09-04

**Product clarification being reviewed against:** NRL and AFL are two completely separate paid competitions ($5 entry each, own entries/prize/results), each built around users picking **2 scorers per game** (try scorers for NRL, goal scorers for AFL) rather than the app automatically evaluating a fixed set of players. This is a materially different mechanic from what Stages 1–4 designed and built, so this review treats it as a real pivot, not a minor addition.
>
> **Correction applied 2026-09-04:** an earlier version of this document described a points-based scoring/leaderboard system. Perfect Play has no points system. Outcomes are strictly tri-state (`pending / correct / incorrect` per selection, `pending / perfect / not_perfect` per entry) — see the corrected §3 and the "No leaderboard/ranking table" note below.

---

## 1. What already supports separate NRL/AFL competitions

The good news: the foundational sports-data layer was already built sport-scoped from Stage 1, and nothing in it merges NRL and AFL into one entity. Specifically:

- **Every domain table is sport-scoped**, directly or via chain: `sports.code` (`nrl`/`afl`) is the root; `teams.sportId`, `players.sportId` reference it directly; `seasons.sportId` → `rounds.seasonId` → `games.roundId` scopes everything downstream to one sport per row. There is no table today that stores an NRL row and an AFL row as the same conceptual entity.
- **The calculation engine is already a per-sport registry**, not a shared/generic evaluator: `src/lib/perfect2/registry.ts` maps `sportCode → SportRule`, with `nrlWingerTryRule` and `aflGoalkickerRule` as fully independent implementations in separate files (`rules/nrl.ts`, `rules/afl.ts`). Nothing about NRL's rule can affect AFL's, and vice versa — this pattern (independent rule per sport, dispatched by code) is directly reusable for the new pick'em settlement logic.
- **Routing and UI are already sport-partitioned**: `/nrl/...` and `/afl/...` are distinct route trees (`src/app/[sport]/...`, driven by `src/lib/sports/config.ts`), each rendering its own round list, round detail, and game detail — there's no shared "combined" page that mixes the two sports' data.
- **`perfect2GameResults`/`perfect2RoundResults`** (the current computed-result cache tables) are both sport-scoped via `sportId`, and keyed by `ruleKey` — so even the existing result-caching pattern already assumes independent, sport-specific rule versions rather than one shared rule.

**Net assessment:** nothing in the current architecture actively conflates NRL and AFL. The separation principle is already respected at the data layer. What's missing isn't a fix — it's an entirely new domain concept (paid competitions, entries, user selections, and binary correct/incorrect results — no points, no leaderboard) that doesn't exist yet at all.

---

## 2. What needs to change later

### 2a. The calculation engine's core assumption no longer holds

`SportRule.evaluateGame()` (`src/lib/perfect2/types.ts`) currently determines *which players qualify* itself, automatically, from lineup data — `nrlWingerTryRule` filters `lineups` for `isStarting && position === "Winger"` and checks if 2+ of *that fixed set* scored. There is no concept of a user or a selection anywhere in this engine.

In the new model, the qualifying players are **chosen by the user as part of a paid entry**, not derived automatically from the lineup. The engine needs a second, complementary function — something like `settleSelection(game, selectedPlayerIds, stats)` — that checks whether the user's *specific* 2 picks scored, independent of position or starting status. This is a different responsibility from `evaluateGame()`, not a drop-in replacement for it (see the open question in §4 about whether both are still needed).

### 2b. `saved_selections` is not the same thing as a competition entry

The existing `savedSelections` table (a `userId` + optional `roundId`/`gameId` + free-text `note`) was built in Stage 1 as a lightweight bookmarking concept. It has no fields for: which competition/round it belongs to, the two selected players, payment status, or a settled result. It cannot represent "user picked Player A and Player B as try scorers for this game, paid $5 to enter." This table will need to be superseded by a proper entry/selection model (§3) — it isn't extensible into one without a redesign.

### 2c. The "Perfect" concept moves from round-level to entry-level

Today, `perfect2RoundResults.isPerfect` is a single global fact about a round (computed once, true for everyone). In the new model, whether an entry is "Perfect" is **specific to one user's one paid entry** into one sport's competition for one round — two different users could have different results for the same round, based on their own picks. This is a fundamentally different aggregation: from "one answer per round" to "one answer per (competition, entry)."

### 2d. Terminology/UI copy describes the old mechanic

The homepage hero, `how-it-works` page, and `RoundPerfectBadge`/`GameStatusBadge` component copy all describe the *automatic* interpretation ("Perfect Play checks whether at least two qualifying players hit the required stat…", "4 starting wingers"). None of this is wrong as documentation of Stage 1's original brief, but it will read as inaccurate once the paid pick'em mechanic is the real product. This is a content/UI change, not an architectural one — flagged for later, not urgent.

### 2e. Money-related fields are needed in the schema even though payment *logic* isn't being built yet

Per the instruction not to implement payments yet, no Stripe/payment-provider integration should be added now. But the **data model** should eventually carry enough fields (entry fee amount, payment status, prize amount) to represent a paid entry even before real payment processing exists behind it — otherwise the entry/results model can't be tested end-to-end with placeholder/manual data later. This is a schema-design note for §3, not a request to build billing now. The prize amount itself (e.g. the product spec's $60 figure) must be a **configurable data value on the competition**, never a hardcoded constant in application logic.

---

## 3. Database tables that should eventually be added or modified

**New tables (none of these exist today):**

| Table | Purpose | Key fields (indicative) |
|---|---|---|
| `competitions` | One row per sport-specific, per-round paid competition instance (e.g. "NRL Round 5 Perfect Play"). This is the entity that makes NRL and AFL *structurally* independent competitions, not just independently-taggable rows. | `id`, `sportId` (not nullable — every competition belongs to exactly one sport), `roundId`, `entryFeeCents`, `status` (`open \| closed \| settled`), `prizeAmountCents` (**configurable per competition, never hardcoded in logic** — e.g. defaults to $60 but is a data value, not a constant), `createdAt` |
| `competition_entries` | One row per user's paid entry into one competition. | `id`, `competitionId`, `userId`, `paymentStatus` (`pending \| paid \| refunded` — shape only, no payment logic yet), `paidAmountCents`, `enteredAt`, `result` (`pending \| perfect \| not_perfect` — **no numeric score, just this tri-state outcome**) |
| `entry_selections` | One row per game within an entry — the user's 2 picks for that specific game. Maps field-for-field to the brief's "must record: game, selected player 1, selected player 2, actual result, whether each selected player scored." | `id`, `entryId`, `gameId`, `selectedPlayer1Id`, `selectedPlayer2Id`, `player1Result` (`pending \| correct \| incorrect`), `player2Result` (`pending \| correct \| incorrect`) — **no points, no per-selection score; a game's own complete/incomplete state is read from `games.status`, not stored again here** |

**No leaderboard/ranking table.** An earlier draft of this review proposed a `competition_leaderboard_entries` table with `rank`/`score` columns — **this has been removed per explicit product direction: Perfect Play has no points system and no ranked leaderboard.** If a results-summary page is needed, it should be a computed aggregate over `competition_entries` (counts of entrants, perfect entries, still-pending entries, and the list of winners — i.e. every entry with `result = 'perfect'`), not a per-user ranking. That aggregate doesn't need its own table; it can be computed on read from `competition_entries`, the same "application logic, not stored opinion" principle used elsewhere in this schema — a cache table only becomes worth adding later if read performance actually requires it.

**Existing tables likely needing modification:**

- **`saved_selections`** — as noted in §2b, this table's shape doesn't fit the real product. Recommend deprecating it in favour of `competition_entries` + `entry_selections` once those are designed in detail, rather than trying to extend it in place.
- **`perfect2_game_results` / `perfect2_round_results`** — needs an explicit decision (flagged as the key open question in §4) about whether these remain as a separate "informational stats" feature or are superseded/repurposed by the entry-settlement tables above.

**Existing tables that do *not* need structural changes:** `sports`, `seasons`, `teams`, `rounds`, `games`, `players`, `game_lineups`, `player_game_stats` all remain exactly as valuable to the new model as to the old one — the new tables above **reference** these (e.g. `entry_selections.gameId → games.id`, `selectedPlayer1Id → players.id`) rather than duplicating anything. The Stage 1–4 work on sports-data ingestion is not wasted; it's the data source both the old automatic stat *and* the new pick'em settlement need.

---

## 4. Conflicts with the current architecture

### The one open question that actually matters: does the original "4 starting wingers, automatic" concept still exist?

This is the central ambiguity this review surfaces, and it's worth resolving before any schema work starts, because it changes the answer materially:

- **If the answer is "no, it's fully replaced"** by the user pick'em mechanic: the current `nrlWingerTryRule`/`aflGoalkickerRule` engine and the `perfect2_game_results`/`perfect2_round_results` tables become dead code/schema once the new entry-settlement logic is built, and should eventually be removed rather than maintained alongside a second, unused system.
- **If the answer is "both exist"** — e.g. the automatic starting-wingers stat stays as an informational/insights feature (browsable stats, unrelated to money), while the *paid competition* is the new, separate pick'em product — then both systems are legitimate and should be kept, but the current UI/copy conflates them under one "Perfect Play" name and would need to visually and semantically separate "Perfect Play Insights" (free, automatic) from "Perfect Play Competition" (paid, user picks).

Nothing in the current codebase is *broken* by this ambiguity today, but it directly determines whether §3's new tables are **additive** (both systems coexist) or a **replacement** (old tables/engine get deprecated). Recommend resolving this explicitly before Stage 6 begins.

### A related, narrower ambiguity: are NRL selections still constrained to wingers?

The original brief was explicit that NRL's condition is about the *4 starting wingers specifically*. This clarification says "the user selects 2 try scorers" without repeating the winger constraint. It's unclear whether:
- (a) the user can pick **any 2 players** in the game as their try-scorer picks, or
- (b) the user must pick from a constrained pool (e.g. still winger-only, mirroring the original concept), or
- (c) the winger constraint was specific to the old automatic-stat idea and has no equivalent in the new pick'em model at all.

This materially affects `entry_selections` validation logic (whether `selectedPlayer1Id`/`selectedPlayer2Id` need an eligibility check against `game_lineups.position`) and is worth confirming rather than assuming, per the same "don't invent the rule" instruction already given for AFL.

### Minor: `SportRule.evaluateGame()`'s current signature doesn't fit the new use case

Flagged in §2a — not a "bug," but a reminder that when settlement logic is eventually built, it should likely live as a new function/interface alongside (not replacing) the existing one until the §4 open question is resolved, so Stage 1's automatic-stat engine isn't broken while the product direction is still being confirmed.

### No conflicts found in: routing, sports config, data-access layer, or UI component structure

`src/lib/sports/config.ts`, the `/[sport]/...` route tree, and `src/lib/data/*` all generalize cleanly to "add competition-related data-access functions alongside the existing ones" — none of them assume anything that the new model would violate.

---

## Recommendation

Do not start Stage 6 implementation until the open question in §4 (does the automatic starting-wingers/key-forwards stat survive alongside the new paid pick'em competition, or is it fully replaced?) is answered — the answer determines whether §3's new tables are purely additive or come with a deprecation of existing `perfect2_*` tables and rule files. Everything else in this review is safe to build on top of without rework.

---

## Resolved decisions (2026-09-04)

Both open questions from §4 have been answered directly by the product owner:

1. **The automatic "4 starting wingers"/"key forwards" stat is fully replaced.** The paid pick'em competition *is* Perfect Play going forward. This means, once Stage 6 implementation begins:
   - `nrlWingerTryRule`, `aflGoalkickerRule`, `registry.ts`, and `evaluate.ts` (the current fixed-rule engine) are to be **removed**, not kept alongside the new settlement logic — they modeled a mechanic that no longer exists.
   - `perfect2GameResults` and `perfect2RoundResults` tables are to be **dropped** (via a migration) once the new `competition_entries`/`entry_selections` tables replace their purpose — not maintained as a second, unused system.
   - The homepage/`how-it-works` copy describing the automatic mechanic will need a full rewrite, not just a tweak, since the product concept itself changed (round-level automatic fact → per-user paid entry).

2. **NRL selections are not position-constrained.** A user may pick **any 2 players from either team** in a game as their try-scorer picks — there is no "must be a starting winger" eligibility rule. Practically:
   - `entry_selections.selectedPlayer1Id`/`selectedPlayer2Id` only need to validate that the selected player is part of that game (e.g. appears in `game_lineups` for one of the two teams), not that they hold any specific position.
   - `game_lineups.position` and `players.position` remain useful for **display** (showing the user who's on the field and what position they play, to inform their pick) but are no longer load-bearing for *eligibility* or *settlement* logic on the NRL side.
   - This resolves cleanly for AFL too, by the same logic, once its final qualification rule is confirmed — the goal-scorer picks are unlikely to need position constraints either, pending that confirmation.

**These decisions are recorded here for Stage 6 to build against. No implementation has started — schema changes, engine removal, and UI rework are all still pending a Stage 6 go-ahead.**
