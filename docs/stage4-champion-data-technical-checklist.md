# Perfect Play — Champion Data Technical Requirements Checklist

Use this during a call or written follow-up with Champion Data, after the initial enquiry (see `stage4-champion-data-enquiry-email.md`). Organized so it can be worked through section by section on a call, with space to record answers.

---

## 1. Required NRL fields

- [ ] Unique, stable **match/game ID** (persists across re-fetches, doesn't change season to season)
- [ ] **Round number** and competition/season identifier
- [ ] **Kickoff date/time** (confirm timezone — AEST/AEDT vs UTC) and **venue**
- [ ] **Home team ID** and **away team ID**, resolvable to stable team records
- [ ] **Final score** (home/away) and match status (scheduled / live / final)
- [ ] **Starting lineup per team**, with an explicit flag or list section identifying who **started** (not just who was named in the wider squad)
- [ ] **Position played in that specific match** (not just a player's generic/nominal position) — specifically, confirm **winger** is a distinguishable position value
- [ ] **Interchange/bench list**, separate from the starting 13
- [ ] **In-game replacement events** — who came on, for whom, and at what time (needed to confirm someone credited as "starting winger" actually started, not just appears in a post-match box score)
- [ ] **Unique, stable player ID** (persists across seasons and games — critical for our "consistent player IDs" requirement)
- [ ] **Try-scoring data per player per game** (count, and ideally timestamp of each try)
- [ ] Any other per-player match statistics available (tackles, run metres, line breaks, etc.) — not required for the core calculation, but useful for future features
- [ ] Confirm whether **State of Origin, finals series, and NRLW** are included or require separate licensing

## 2. Required AFL fields

*(Note: Perfect Play's AFL statistical rule is not yet finalised — this section is about confirming what's technically available, not committing to a specific rule.)*

- [ ] Unique match ID, round number, season identifier
- [ ] Kickoff date/time, venue
- [ ] Home/away team IDs
- [ ] Final score and match status
- [ ] Starting lineup per team, with starting vs interchange distinction
- [ ] Position played in that match (confirm what position taxonomy Champion Data uses — e.g. key forward, small forward, wing, etc.)
- [ ] Player-level statistics available (goals, disposals, marks, tackles, etc.)
- [ ] Unique, stable player ID
- [ ] Confirm whether **AFLW and state leagues** are included in the same license or require separate agreements (their public AFL API docs reference AFL Premiership, AFLW, and state leagues — confirm which are actually in scope for our license)

## 3. Historical requirements

- [ ] Confirm availability of full 2024 NRL season data
- [ ] Confirm availability of full 2025 NRL season data
- [ ] Confirm 2026 season data is available now / as the season progresses
- [ ] Confirm ongoing access to future seasons is included in the same agreement (not a separate renegotiation each year)
- [ ] Ask how far back historical data actually goes, beyond our minimum need (useful for future "all-time" features)
- [ ] Confirm whether historical backfill is a one-off bulk export, an API you can page through, or something that requires a separate request/fee

## 4. Live/upcoming requirements

- [ ] Confirm fixtures/upcoming games are available ahead of round start (how many days out?)
- [ ] Confirm when starting lineups typically become available relative to kickoff (this determines our sync polling schedule — see `stage3-sports-data-provider-research.md` §8)
- [ ] Confirm whether lineups can change between initial announcement and kickoff, and whether the API reflects the **most recent** version or requires re-polling
- [ ] Confirm whether live in-game data (real-time score/event updates) is available, and whether it's part of the same license or a separate product — **not required for MVP**, but worth knowing for the roadmap
- [ ] Confirm typical delay between full-time and final/official stats being available (relevant for our "final stats" sync step)
- [ ] Confirm whether stats are ever corrected/revised after initial posting (e.g. video review reassigning a try), and if so, how that's signalled (e.g. an updated-at timestamp)

## 5. API requirements

- [ ] Confirm delivery mechanism: REST API, webhook/push feed, or file-based feed (e.g. FTP export)
- [ ] Confirm response format (JSON preferred; confirm if XML-only)
- [ ] Request API documentation access (even read-only/sample) before committing
- [ ] Confirm whether there's a dedicated NRL API equivalent to their public AFL API (`docs.api.afl.championdata.com`), or whether NRL is only available via a different mechanism
- [ ] Confirm environment separation: is a staging/sandbox environment available separate from production?

## 6. Authentication

- [ ] Confirm authentication method (API key, OAuth2 bearer token, IP allowlisting, etc.) — their AFL API is known to use OAuth2 bearer auth; confirm if NRL access matches
- [ ] Confirm how credentials are provisioned and rotated
- [ ] Confirm if there are per-environment credentials (dev/staging vs production)

## 7. Rate limits

- [ ] Confirm request-per-second / per-day limits, if any
- [ ] Confirm whether rate limits differ for historical bulk backfill vs ongoing incremental sync
- [ ] Confirm behavior on rate-limit breach (hard block, throttling, overage billing)

## 8. Data retention

- [ ] Confirm whether we are permitted to **retain** historical data indefinitely in our own database, or only cache it for a limited period
- [ ] Confirm what happens to already-stored data if the contract is terminated or not renewed — are we required to delete it?
- [ ] Confirm if there's a distinction between "raw feed data" retention rules and "our own derived/computed data" retention rules

## 9. Commercial licensing

- [ ] Confirm the license explicitly covers use in a public-facing commercial SaaS/web application (not just internal/editorial use)
- [ ] Disclose Perfect Play's roadmap includes future betting-related insights, and ask whether that changes licensing terms, tier, or requires a different agreement
- [ ] Confirm minimum contract term
- [ ] Confirm any setup fee
- [ ] Confirm renewal/cancellation terms

## 10. Derived statistics

- [ ] Confirm explicitly: are we permitted to compute our own derived statistic (the Perfect Play YES/NO/Perfect calculation) from the licensed data?
- [ ] Confirm whether that derived statistic can be **stored** in our own database (not just computed at request-time)
- [ ] Confirm whether there's any restriction on the *form* the derived statistic can take (e.g. must not resemble a competing raw-data product)

## 11. Display / redistribution rights

- [ ] Confirm we can display player names, team names, and match statistics in our UI
- [ ] Confirm any required attribution wording/placement ("Stats supplied by Champion Data" or similar) and where it must appear
- [ ] Confirm explicitly that **redistribution or resale of the raw licensed feed itself** is prohibited (expected, but get it in writing so our engineering team knows the boundary)
- [ ] Confirm whether displaying our derived Perfect Play results (not raw stats) is considered outside that redistribution restriction

## 12. Pricing

- [ ] Startup/developer pricing tier — does one exist for pre-revenue products?
- [ ] Monthly pricing option
- [ ] Annual pricing option (and any discount vs monthly)
- [ ] Usage-based pricing (per-request/per-call) as an alternative to flat licensing
- [ ] Enterprise/custom pricing — at what scale does this apply?
- [ ] Minimum contract period
- [ ] Setup/onboarding fee
- [ ] Whether NRL and AFL are priced together or as separate line items

## 13. Support / SLA

- [ ] Confirm support channels (email, dedicated account manager, ticketing)
- [ ] Confirm any uptime SLA or guaranteed data-freshness commitment
- [ ] Confirm incident-notification process if their data feed has an outage or data quality issue
- [ ] Confirm typical response time for support queries

## 14. Sandbox / sample data

- [ ] Request a trial or sandbox environment before committing to a contract
- [ ] Request a sample historical NRL match payload (ideally a real completed match) showing lineup, position, and statistics fields, to validate against our exact requirement (identifying the 4 starting wingers and their try counts) before signing anything
- [ ] If a live sandbox isn't offered, ask whether they can share example/schema documentation instead

---

## CHAMPION DATA APPROVAL GATE

**We can proceed to implementation only when all of the following are confirmed in writing (email, contract, or documented call notes — not just verbally implied):**

- [ ] **Starting lineup distinction** — confirmed their data separates starting players from interchange/bench and from players who came on later
- [ ] **Starting position/winger identification** — confirmed the 4 players who started each NRL game at winger can be reliably identified
- [ ] **Historical 2024–2026 availability** — confirmed for all three seasons, plus ongoing future-season access
- [ ] **Player/game statistics** — confirmed try-scoring and other per-player, per-game stats are available with stable player/team IDs
- [ ] **API/feed access** — confirmed a programmatic way to retrieve this data (not manual export only)
- [ ] **Database storage rights** — confirmed we may persist licensed historical data in our own PostgreSQL database
- [ ] **Derived-statistic rights** — confirmed we may calculate and store our own Perfect Play result from their data
- [ ] **Commercial display rights** — confirmed we may publicly display our derived Perfect Play results in a commercial SaaS product
- [ ] **AFL coverage** — confirmed whether AFL data is available under the same or a separate agreement, and what detail level
- [ ] **Pricing** — confirmed a concrete number or pricing structure we can budget against
- [ ] **Contract requirements** — confirmed minimum term, setup fees, termination/data-retention terms, and required attribution

**Until every box above is checked, Stage 5 (schema changes, API keys, sync service implementation, data seeding) should not begin.**
