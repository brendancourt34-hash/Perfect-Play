# Perfect Play — Stage 3: Sports Data Provider Research & Integration Plan

**Status:** Research only. No code, schema, API keys, or data were changed as part of this stage.
**Date:** 2026-09-04

---

## 1. Recommended provider

**Champion Data** — contact for a commercial license and technical scoping call before purchasing.

This is a **"contact provider first"** recommendation, not an unconditional go-ahead. Public documentation does not give enough detail to *guarantee* Champion Data's NRL feed distinguishes "started at winger" from "interchanged on," so that must be confirmed directly (see §12).

---

## 2. Why Champion Data

- **It is the actual source of truth.** Champion Data has been the AFL's official statistics provider since 1999 (confirmed, Wikipedia/AFL) and is independently confirmed as a contracted NRL stats provider — NRL.com's own Match Centre stats are attributed to Champion Data, and Champion Data runs a dedicated `@ChampionDataNRL` account. When a provider *is* the entity producing the league's own official match centre, its lineup/position data has the shortest possible chain of custody back to what actually happened on the field — directly relevant to your requirement that starting-winger determination be authoritative, not inferred.
- **Position-level granularity is independently verifiable today.** The open-source R package `nrlR` (CRAN) wraps Champion Data's "MC API" for NRL/NRLW/State of Origin and documents that `fetch_player_stats(source = "championdata")` returns a table including `player_name`, `team`, **`position`**, `tries`, `assists`, `line_breaks` per player per match. This is real evidence — not a marketing claim — that the underlying data model carries the field Perfect Play needs. It does **not** by itself prove the field distinguishes "started this match at winger" vs. "nominal/listed position," which is why direct confirmation is still required.
- **It's the only researched provider confirmed to natively cover both NRL and AFL** as the actual official data originator (not a redistributor), directly answering your "can one provider cover both sports" question. AFL access is further evidenced by a public, documented API (`docs.api.afl.championdata.com`) — OAuth2-secured, with lineup/position/IN-OUT-change endpoints already live. No equivalent public NRL doc site was found, implying NRL access is sold bilaterally rather than self-serve.
- **Caveat:** Champion Data's Sport Data Platform is explicitly **not publicly self-serve** — their own service desk states access is "restricted to accredited organisations," gated by commercial/licensing agreement. There is no public pricing.

---

## 3. Alternatives, ranked

| Rank | Provider | One-line verdict |
|---|---|---|
| 2 | **Stats Perform / Opta** | Independently confirmed official NRL data provider (10+ years, ~14,000 datapoints/match) with the deepest event-level data of any candidate — but no evidence of AFL coverage, and likely the most expensive/enterprise-gated option. |
| 3 | **Data Sports Group (DSG)** | Mid-market aggregator explicitly documenting "starting players per team" for NRL and "position" fields for AFL, plus historical archives as an add-on. Not an official league partner, so provenance/accuracy of "who actually started" is unverified — but by far the best-documented mid-tier option and likely more startup-accessible than the official duopoly. |
| 4 | **Goalserve** | Confirms NRL coverage and a "Team Lineups & Substitutes" feed, transparent (if narrow) published pricing ($150–$1,000+/yr for the rugby-only tier), but position-level detail and try-scorer breakdowns for rugby specifically are unconfirmed in public docs, and it is not an official source. |
| 5 | **Sportradar** | Excellent API engineering/documentation reputation and confirmed separate Rugby League v3 and Aussie Rules Football products — but NRL's specific inclusion in the Rugby League product could not be confirmed from public docs, historical depth looks shallow ("max 3 seasons" for rugby, "two previous seasons" for AFL), and pricing starts around $1,250/mo, scaling to $10,000+/mo. Likely a *redistributor* of official data (e.g. from Champion Data/Stats Perform) rather than a primary collector for these domestic leagues — unconfirmed but consistent with industry norms. |
| 6 | **API-Sports (api-sports.io)** | Cheapest and most self-serve ($10–low hundreds/month, free tier available), and its marketing copy explicitly names NRL as covered — but no evidence of a lineups/position endpoint for rugby (unlike its football product), and no evidence of any AFL product. Fine as a cheap fixtures/results supplement; not sufficient as the source of truth for starting wingers. |

**Ruled out as not viable for this requirement:**
- **Genius Sports** — no evidence found of NRL or AFL coverage in current research (their confirmed rugby relationship is Major League Rugby, a different code/competition in North America).
- **Squiggle API** (free AFL community API) — explicitly limited to fixtures, ladder, and scores/predictions; no lineup, position, or player-statistic data. AFL-only, no NRL. Unofficial/community-run, so commercial licensing status is doubtful regardless.
- **SportsDataIO** — confirmed no rugby league or AFL product in its portfolio.

---

## 4. Pricing

| Provider | Free/Trial | Developer | Commercial | Enterprise/Custom |
|---|---|---|---|---|
| Champion Data | None found | None found | **Not public** — "Commercial Enquiries" via service desk / info@championdata.com, gated by accreditation | Same — fully custom, contact required |
| Stats Perform / Opta | None found | None found | **Not public** — standard Opta model is custom licensing "by competition, country, or data level," sales-gated | Same — enterprise-only in practice |
| Sportradar | Free trial: 1,000 queries, 1 req/sec | — | Reported market range ~$1,250/mo+ (third-party source, not confirmed on Sportradar's own site) | $10,000+/mo reported for full enterprise contracts |
| Data Sports Group | Free API trial (contact form) | Unknown | "Flexible licensing packages" — not public | Custom |
| Goalserve | — | Rugby-only "Live Score" tier: $150/mo, $750/6mo, $1,000/yr | Full multi-sport package: $800/mo, $3,550/6mo, $5,100/yr | Custom for larger needs |
| API-Sports | Free tier: 100 req/day | From ~$10/mo | Tiers scale up to ~1.5M req/day (exact price breakpoints not confirmed — page returned 403 during research) | Custom |

**Uncertain — confirm with provider:** exact Champion Data and Stats Perform pricing (neither publishes rates; both require a sales conversation). Treat any number you hear informally as anecdotal until it's in a quote.

---

## 5. Historical coverage

| Provider | Stated historical coverage | Confidence |
|---|---|---|
| Champion Data | Not publicly stated. Given they've powered official AFL stats since 1999 and NRL stats for a multi-year period, deep archives almost certainly exist internally — but what's available *to a new commercial licensee via API* (vs. only visible on nrl.com) is unconfirmed. | **Unknown — confirm with provider** |
| Stats Perform/Opta | "Ten years as official NRL data provider" (as of the 2024 season) is explicitly stated, implying data collection back to ~2014-15 at least. Whether that full depth is available via a standard commercial API license (vs. requiring a bespoke historical-archive purchase) is unconfirmed. | Medium-high confidence on existence; **unknown on commercial access** |
| Sportradar | Rugby API docs state competitions return "a maximum of three seasons of data, including current or newly created seasons." Aussie Rules Football docs state "historical results for two previous seasons." Both are shallow relative to your 2024–2026+ need and could fall short depending on exactly when "current season" resets. | **Confirmed limited — a real risk if selected** |
| Data Sports Group | "Historical Data Archives" listed as an available add-on for both NRL and AFL, but no specific year range given. | **Unknown — confirm with provider** |
| Goalserve | States "Historical Data since 2010" for the Rugby API generally (not NRL-specific). | Medium confidence, NRL-specific depth unconfirmed |
| API-Sports | Not stated for rugby specifically. | **Unknown** |

None of the researched providers publicly commit, in writing, to an exact season-by-season NRL historical depth. **This must be confirmed directly with each shortlisted provider before any purchase decision**, since it's foundational to Perfect Play's "browse historical rounds" feature.

---

## 6. Data field mapping (provider → Perfect Play database)

This mapping is illustrative — exact field names depend on which provider is selected and will need to be confirmed against that provider's actual schema (a technical scoping call or sandbox trial is the only reliable way to do this). It's expressed against typical fields seen across the researched providers (Champion Data's `nrlR`-documented shape, Opta's standard rugby data model, and DSG's documented feed) and Perfect Play's existing Drizzle schema (`src/db/schema.ts`).

| Perfect Play table.column | Typical provider field | Notes |
|---|---|---|
| `sports.code` / `sports.name` | Competition/sport identifier | Static, set once (`nrl`, `afl`) |
| `seasons.year`, `seasons.label` | `season.year`, `season.name` | |
| `rounds.roundNumber`, `rounds.name` | `round.number`, `round.name` | Watch for finals weeks, which some providers number differently from the docs (e.g. "Finals Week 1" vs round 28) |
| `rounds.startDate` / `endDate` | Derived from earliest/latest game kickoff in the round | Perfect Play computes this; not usually a direct provider field |
| `teams.name`, `teams.shortName`, `teams.slug` | `team.name`, `team.short_name`/`team.code` | |
| `teams.externalId` | `team.id` (provider's own team ID) | **Critical**: store this so re-syncs match existing rows instead of duplicating |
| `games.homeTeamId` / `awayTeamId` | `match.home_team.id`, `match.away_team.id` | Resolve via `teams.externalId` |
| `games.kickoff` | `match.scheduled`/`match.kickoff_utc` | Store as UTC `timestamptz`; format in AU timezone at render time (already implemented in `formatAuDateTime`) |
| `games.venue` | `match.venue.name` | |
| `games.status` | `match.status` (scheduled/live/final, naming varies) | Map provider's status vocabulary onto Perfect Play's `scheduled \| live \| final` |
| `games.homeScore` / `awayScore` | `match.home_score`, `match.away_score` | |
| `games.externalId` | `match.id` (provider's own match ID) | **Critical** — the natural dedup key; `games.externalId` is already `unique()` in the schema |
| `players.firstName` / `lastName` | `player.first_name`, `player.last_name` | |
| `players.externalId` | `player.id` (provider's own player ID) | **Critical** — this is what makes "stable player IDs across seasons" work; already `unique()` in schema |
| `players.position` | `player.position` (nominal/roster position) | This is the *listed* position, not necessarily what they played in a specific game — see next row |
| `game_lineups.position` | `lineup_entry.position` (**position played in this specific match**) | This is the field that actually matters for the winger rule — must confirm it reflects what the player started the match at, not their generic profile position |
| `game_lineups.isStarting` | `lineup_entry.is_starting` / inferred from "starting 13/17/22" vs. interchange list | Some providers only expose this as list order/section (starters vs. bench) rather than an explicit boolean — needs mapping logic in the sync service |
| `game_lineups.jumperNumber` | `lineup_entry.jersey_number` | Optional, useful for display/debugging mismatches |
| `player_game_stats.tries` | `player_stats.tries` | The core Perfect Play NRL signal |
| `player_game_stats.goals` | `player_stats.goals`/`conversions` | Used by the current AFL placeholder rule (goals kicked); NOT used by the finalized NRL rule |
| `player_game_stats.stats` (jsonb) | Any additional per-provider metrics (line breaks, tackles, disposals, etc.) | Freeform bucket — no schema change needed to absorb provider-specific extras |
| `perfect2_game_results` / `perfect2_round_results` | *Not from provider* | Computed entirely by Perfect Play's own calculation engine (`src/lib/perfect2/`) from the rows above — never written by the sync job |

---

## 7. Recommended API architecture

```
Provider API (Champion Data / chosen provider)
        │
        ▼
Sync service (new: e.g. `src/lib/sync/`, run as a scheduled Vercel Function or Vercel Cron job)
  • Auth: provider credentials read from env vars only (never client-exposed)
  • Fetch: rounds → games → lineups → player stats, incrementally
  • Map: provider fields → Perfect Play schema shape (§6)
        │
        ▼
Validation layer (see §9) — runs BEFORE any DB write
  • Structural checks (required fields present, IDs resolvable)
  • Business-rule checks (exactly 13/17 players marked starting per NRL side, no duplicate player in two positions, etc.)
  • Reject + log rather than silently write on failure
        │
        ▼
PostgreSQL (Neon, already provisioned) — upsert by externalId
  • games: upsert by games.externalId
  • players: upsert by players.externalId
  • game_lineups / player_game_stats: upsert by the existing (gameId, playerId) unique constraints
        │
        ▼
Perfect Play calculation engine (src/lib/perfect2/, already built)
  • Runs evaluateRound() against freshly-synced lineups/stats
  • Writes to perfect2_game_results / perfect2_round_results as a cache
  • No changes needed here — it already consumes exactly this shape
        │
        ▼
UI (src/app/[sport]/..., already built)
  • Already renders "unavailable" states when data is absent — will naturally start
    showing real content the moment the sync populates rows, with no UI code changes required
```

This confirms a key architectural win from Stage 1: because the calculation engine and UI were built against `DataResult<T>` and the existing schema rather than against any specific provider's shape, **the only new code this integration requires is the sync service and its validation layer** — nothing in `src/lib/perfect2/` or `src/app/` needs to change.

---

## 8. Sync strategy

| Data type | Recommended frequency | Rationale |
|---|---|---|
| Upcoming fixtures (rounds/games, no lineups yet) | Daily | Fixtures rarely change once published; daily is enough to catch reschedules |
| Starting lineups | Every 15–30 min from ~48h before kickoff, stopping at kickoff | Lineups are frequently announced 1–2 days out and can change up to and sometimes just after kickoff (late outs) — this is the highest-value polling window for Perfect Play's accuracy |
| Live in-game events (optional, not required for MVP) | Real-time push/webhook if the provider offers it; otherwise 1–2 min polling | Only needed if you want live "is this game trending YES" updates; not required to compute the final result |
| Completed-game final stats | Once ~30–60 min after full-time (allow for stat corrections), then a follow-up re-check ~24h later | Official stats are sometimes corrected post-match (e.g. a try reassigned after video review) — a delayed re-check catches this |
| Historical backfill (once, at integration time) | One-off batch job, season by season, rate-limited to the provider's quota | Needed to populate 2024–2025 data so historical Perfect Play rounds aren't empty on launch |

All sync runs should be idempotent (safe to re-run) via the `externalId` upsert keys already in the schema — a re-run should update existing rows, never duplicate them.

---

## 9. Data validation safeguards

| Risk | Safeguard |
|---|---|
| Wrong/missing lineup positions | Reject a lineup sync if a team doesn't have **exactly the expected count** of starters at a given position type for that sport (e.g. NRL: exactly 4 starting wingers expected per game) — log a warning and leave the game in `insufficient_data` rather than computing a wrong result. The engine already does this at the calculation layer (`nrlWingerTryRule` returns `insufficient_data` below 4 recorded starting wingers); the sync layer should additionally alert (not just silently accept) when a provider returns an unexpected count, since that usually signals a mapping bug rather than a real data gap. |
| Player IDs drifting or colliding | Always upsert by `players.externalId`, never by name-matching (name collisions are common — e.g. common surnames). If a provider ever lacks a stable ID for a player, treat that record as unmatched and hold it for manual review rather than guessing. |
| Duplicate games | Enforced at the DB level already — `games.externalId` has a `unique()` constraint, so a re-sync naturally upserts rather than duplicates. |
| Duplicate statistics | Enforced at the DB level already — `player_game_stats` has a unique constraint on `(gameId, playerId)`. |
| Lineups changed after initial sync (late outs, HIA replacements) | Re-sync lineups right up to kickoff (see §8); store `isStarting` per the *last* pre-kickoff sync, and keep the raw provider payload timestamp so a late change is auditable, not just overwritten silently. |
| Provider outage or partial data mid-round | Never fabricate or interpolate missing values — the engine already returns `insufficient_data` / `isComplete: false` rather than a false YES/NO, and the UI already renders that honestly (built in Stage 1). Extend this discipline to the sync layer: a failed fetch should leave existing rows untouched, not null them out. |
| Schema drift from the provider (field renamed/removed) | Validate the raw payload shape against a schema (e.g. zod) before mapping; fail loudly (alert) rather than silently writing nulls into required columns. |

---

## 10. Legal/licensing considerations to verify before launching commercially

1. **Explicit commercial-use permission** for a public-facing SaaS/web app that displays derived statistics and predictions — not just internal analytics use. Confirm this in writing, not inferred from a generic "commercial plan" name.
2. **Betting-adjacency review.** Perfect Play is statistics/analysis, not wagering itself, but its framing (rounds being "Perfect," future "betting-related insights") sits close to a use case that official data providers often price and gate differently (and sometimes restrict) from pure media/analytics use. Disclose the intended use case (including the future betting-insights roadmap) upfront rather than after a contract is signed under a narrower use case.
3. **Right to store historical data in your own database**, not just query it live each time. Some data licenses are "query-time only" and prohibit persistent storage/caching beyond a short TTL — this would break Perfect Play's "browse historical rounds" feature and the `perfect2_*` result cache. Get this in writing.
4. **Right to compute and display derived statistics** (i.e., the Perfect Play YES/NO/Perfect calculation itself) rather than only the provider's raw stats verbatim. Most providers permit this, but Opta's public Pulse addendum explicitly restricts *redistributing or reselling* the underlying licensed data itself — confirm Perfect Play's derived-and-transformed output falls outside that restriction.
5. **No resale/redistribution of raw feed data.** Standard across every provider researched (explicit in Opta's addendum, implied elsewhere). Perfect Play must only ever expose its own computed results and light contextual data (team names, dates, scores), never a bulk export of the raw licensed feed.
6. **Attribution requirements.** Many providers require "Powered by/Data supplied by X" attribution — confirm the exact required wording/placement and add it to the UI (e.g. footer) once a provider is selected.
7. **Player likeness/image rights**, if you ever add player photos — separate from the stats license (Champion Data's AFL API docs show separate "profiles" data; image rights are commonly licensed independently).
8. **Termination/data-retention clause.** If the contract ends, what happens to already-stored historical data? Some licenses require deletion on termination — relevant to long-term product planning, not just launch.
9. **Jurisdiction/compliance**: since Perfect Play is Australia-focused and betting-adjacent, factor in Australian Interactive Gambling Act / state wagering-advertising rules if the roadmap's "betting-related insights" feature is ever built — this is a legal review separate from the data license itself.

None of the above can be resolved from public documentation — all nine require a direct conversation with the shortlisted provider's commercial/legal team.

---

## 11. Estimated cost (indicative only — see caveats)

These are **rough planning estimates**, not quotes. API costs for official Australian sports data are not publicly listed by either top candidate, so the ranges below are inferred from (a) published pricing of comparable/adjacent providers (Sportradar, Goalserve) and (b) general sports-data market pricing patterns. Treat every number here as **"Unknown — confirm with provider"** until a real quote is in hand.

| Stage | API cost (indicative) | Infrastructure cost (Vercel + Neon) | Notes |
|---|---|---|---|
| Development / pre-launch | $0–$500/mo (free trial / small dev tier, if offered) | ~$0–$40/mo (Vercel Hobby/Pro + Neon free/launch tier) | Official providers may offer a discounted or free sandbox for a signed-but-pre-launch partner; must ask |
| 100 users | Likely still flat-rate, not usage-based per end user — official sports-data licenses are almost always priced by *data scope* (competitions/seasons) not by *your app's* traffic — est. **$300–$2,000/mo** | ~$20–$60/mo | At this scale, infra cost is negligible; API licensing is the entire cost driver |
| 1,000 users | Same license tier likely still covers this — sports data contracts rarely scale with your DAU, they scale with which competitions/data depth you've licensed — est. **$300–$2,000/mo** (same tier, unless you add live/real-time push feeds) | ~$40–$150/mo (more function invocations, Neon compute) | Revisit if you add live in-play polling, which some providers price separately |
| 10,000 users | Same API tier likely sufficient; infra becomes the variable cost | ~$150–$500+/mo (Vercel Pro/Enterprise usage, Neon scaled compute + storage) | If the roadmap adds real-time odds/live scoring at this scale, budget for a higher-tier or enterprise data contract — **confirm with provider** |

**Key takeaway:** for this kind of product, official sports-data licensing is priced by *scope of data* (which leagues, seasons, and feed types), essentially flat regardless of Perfect Play's own user count — unlike your Vercel/Neon bill, which does scale with usage. Budget conversations with Champion Data/Stats Perform should center on "which competitions and seasons do we need," not "how many users will we have."

---

## 12. Decision matrix

Scored 1 (unusable) – 5 (excellent) per criterion, weighted per the brief. Where public information didn't disclose something, it's marked **"Unknown — confirm with provider"** rather than guessed generously — those cells were scored conservatively (3, never higher) rather than assumed favorable.

| Provider | NRL historical (20%) | Starting lineups (20%) | Position data (15%) | Player stats (10%) | AFL coverage (10%) | API quality (5%) | Commercial licensing (10%) | Data storage/derived rights (5%) | Pricing/value (5%) | **Weighted /100** | Major limitation |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| **Champion Data** | 4 | 5 | 5 | 5 | 5 | 3 (Unknown for NRL specifically) | 3 (Unknown) | 3 (Unknown) | 3 (Unknown) | **86** | Not self-serve; gated behind accreditation + custom commercial contract; no public pricing or NRL API docs |
| **Stats Perform / Opta** | 4 | 5 | 4 | 5 | 2 (no AFL evidence found) | 4 | 3 (Unknown) | 3 (Unknown) | 2 (likely premium enterprise) | **77** | No confirmed AFL coverage — likely needs a second provider for AFL; premium enterprise pricing expected |
| **Data Sports Group** | 3 (Unknown depth) | 4 | 3 (confirmed for AFL, not explicit for NRL) | 4 | 4 | 3 (Unknown track record) | 4 | 3 (Unknown) | 3 (Unknown) | **70** | Not an official league source — provenance/accuracy of "who started" unverified |
| **Goalserve** | 3 (Unknown NRL-specific depth) | 4 | 2 (not confirmed) | 3 | 4 | 3 | 4 | 3 (Unknown) | 4 | **66** | Not an official source; position-level detail and try-scorer breakdown unconfirmed |
| **Sportradar** | 2 (docs suggest only ~3 seasons) | 3 (feed exists, NRL-specific unconfirmed) | 2 (not confirmed) | 3 | 3 (confirmed but only ~2 seasons history) | 5 | 3 (use-case gated, betting-adjacent scrutiny likely) | 3 (Unknown) | 2 (from ~$1,250/mo) | **54** | Shallow historical depth confirmed in docs; NRL inclusion in Rugby League product unconfirmed; likely a redistributor, not primary source |
| **API-Sports** | 2 (Unknown) | 2 (no lineup endpoint confirmed for rugby) | 1 (no evidence) | 2 (Unknown) | 1 (no AFL product found) | 3 | 4 (accessible self-serve) | 3 (Unknown) | 5 | **44** | No evidence it has the starting-lineup/position data at all — the one requirement that matters most |
| Genius Sports | 1 | 1 | 1 | 1 | 1 | 3 | 3 | 3 | 3 | **~17** | No confirmed NRL or AFL coverage found — not a viable candidate on current evidence |
| Squiggle API | 1 (AFL only, no NRL) | 1 (fixtures/scores only, no lineups) | 1 | 1 | 3 (AFL only, basic) | 3 | 1 (unofficial/community) | 1 | 5 (free) | **~15** | No lineup, position, or player-stat data at all — fails the core requirement outright |
| SportsDataIO | 1 | 1 | 1 | 1 | 1 | 3 | 3 | 3 | 3 | **~13** | Confirmed no NRL/AFL product exists |

### Ranking

- **#1 — Best choice: Champion Data.** Highest confidence in data provenance and accuracy (it *is* the official source), the only confirmed single-provider option spanning both NRL and AFL, and independent third-party evidence (the `nrlR` package) that its NRL data model already carries a position field.
- **#2 — Backup: Stats Perform / Opta.** Independently confirmed official NRL provider with possibly the deepest event-level data of any candidate, but no confirmed AFL coverage and likely the most expensive/enterprise-gated option — strong as a pure-NRL fallback or a second source to cross-validate Champion Data.
- **#3 — Backup: Data Sports Group.** Best-documented mid-market aggregator; worth a parallel trial-access request as a faster-to-access, likely cheaper fallback if Champion Data's accreditation process or pricing turns out to be a blocker.
- **#4 — Backup: Goalserve.** Transparent published pricing and confirmed NRL lineup feed; weaker on position-level and try-scorer confirmation, worth a trial-key test if #1–#3 stall.
- **#5 and below:** Sportradar, API-Sports, and the three ruled-out providers are not recommended as the primary NRL source given current evidence — Sportradar mainly on unconfirmed/shallow historical depth and NRL inclusion, API-Sports on a near-total lack of evidence for lineup/position data, and the rest on outright missing coverage.

### Is #1 good enough to proceed with immediately, or do we contact the provider first?

**Contact the provider first.** Champion Data's public materials establish *strong circumstantial confidence* (official-source status for both leagues, a third-party-verified position field in the NRL data model) but **do not publicly confirm**: exact historical season depth available to a new licensee, whether the "position" field distinguishes started-vs-interchanged, pricing, or explicit written permission to store historical data and display derived Perfect Play results commercially. All of that requires a direct commercial/technical conversation — not something further web research can resolve, since it sits behind their accredited-access gate.

---

## GO / NO-GO decision

**RECOMMENDATION: CONTACT PROVIDER FIRST**

> *"Can this provider reliably give Perfect Play everything required to calculate the NRL Perfect Play statistic across historical seasons and future games?"*

**Not an unequivocal yes — not yet.** Champion Data is the strongest candidate found, with real (if circumstantial) evidence it has the right data shape and the right provenance. But three specific things are missing before this can become a firm GO, and none of them are answerable from public documentation:

1. **Confirmation that the lineup "position" field reflects who actually started the match** (vs. named squad, vs. bench who came on) — this is the single most important fact for Perfect Play's accuracy and the brief explicitly flags it as more important than raw stat availability. Request a sample payload or trial credentials and inspect a real historical game before committing.
2. **Confirmed historical depth** covering at minimum 2024–2025 (ideally further back), and confirmed forward availability for 2026+ as the season progresses.
3. **Written commercial terms**: pricing, explicit permission to persist historical data in Perfect Play's own Postgres database, and explicit permission to compute and publicly display the derived Perfect Play YES/NO/Perfect calculation — plus the betting-adjacency and attribution points in §10.

**Recommended next step:** open a commercial enquiry with Champion Data (`info@championdata.com` / their service-desk "Commercial Enquiries" request type) describing Perfect Play's exact use case, and request either a sample NRL match payload or trial API access to validate point 1 against a real historical game before signing anything. In parallel, open a lower-cost/faster-turnaround conversation with Data Sports Group as a hedge, in case Champion Data's accreditation process or prospective pricing is a poor fit for a pre-revenue product. Stats Perform is worth a parallel enquiry specifically as an NRL-only fallback, but budget for it being materially more expensive to access than Champion Data.

**No further engineering work (schema changes, API keys, sync service, seeding) should begin until at least one of these conversations produces confirmed answers to points 1–3 above.**
