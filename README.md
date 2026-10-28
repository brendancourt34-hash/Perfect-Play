# Perfect Play

Perfect Play is an Australian NRL, AFL, NBA & NFL prediction competition: pick the Perfect Round.
For a $5 entry, pick one player per game of a round — a try scorer for NRL, a goal scorer for AFL,
a player to score 25+ points for NBA, or a touchdown scorer for NFL — any eligible player, any
position. Get every pick right across the whole round to go **PERFECT** and take the entire pool;
more than one PERFECT entry splits the pool evenly.

Each sport runs as its own completely separate $5 competition — enter one, or all of them. They
are never combined: separate entries, separate results, separate prize pools.

There is no points system. Every outcome is a tri-state result: **pending / correct / incorrect**
per player pick, rolling up to **pending / perfect / not_perfect** per game and per entry. No
points, no per-selection score, no ranked leaderboard.

Perfect Play never fabricates results: every pick is settled from real statistics data. Until a
live data source is connected, the UI clearly marks data as unavailable rather than showing
invented results.

**Perfect Play's primary customer-facing product is a native mobile app** (`mobile/`, React Native
+ Expo) distributed through the App Store and Google Play. This Next.js app is the backend/API/admin
foundation both the web UI and the mobile app are built on. See
`docs/mobile-app-architecture.md`.

## Stack

- **Next.js 16** (App Router, TypeScript, Turbopack)
- **Tailwind CSS v4** for styling
- **Drizzle ORM** + **Neon Postgres** (serverless driver) for data
- **Vitest** for unit tests
- Deployed on Vercel

## Getting started

```bash
npm install
npm run dev
```

The app runs without a database connected — pages render clearly-labelled "data not
connected" states instead of crashing or showing fake data.

### Connecting a database

1. Provision a Postgres database (recommended: `vercel integration add neon`, or use any
   Postgres-compatible provider).
2. Copy `.env.example` to `.env.local` and set `DATABASE_URL`.
3. Push the schema: `npm run db:push`
4. (Optional) Inspect data: `npm run db:studio`

Schema changes go in `src/db/schema.ts`; run `npm run db:generate` to produce a migration
file in `drizzle/`.

### Running tests

```bash
npm run test
```

Covers the settlement engine (`src/lib/perfect2/settle.ts`) and selection validation
(`src/lib/selections/validate.ts`) — pure functions, no database required.

## Architecture

```
Sports data:  Sport → Season → Round → Game → Teams → Players → Player game stats
Competition:  Competition (sport-scoped) → Entry → Selection (1 player per game) →
              per-selection result → overall entry result
```

- `src/db/schema.ts` — sports-data tables (sports, seasons, rounds, teams, players, games,
  game lineups, player game stats) plus the competition model (`competitions`,
  `competition_entries`, `entry_selections`) and `users`. No points/leaderboard table exists.
  `entry_selections`' second player slot is nullable and only ever populated on entries
  created before the Phase 23F "1 player per game" rules update.
- `src/lib/perfect2/` — the settlement engine. `settle.ts` has pure functions
  (`settleSelection`, `settleGameSelection`, `settleEntry`) that turn stat counts into the
  tri-state results described above, operating over however many selections a game actually
  has. `registry.ts` maps sport code → `SportSelectionConfig` (which stat counts, the
  threshold, the UI label, and selections-per-game) — every sport is a fully independent
  config.
- `src/lib/selections/validate.ts` — validates a user's picks: every player must be
  eligible for that specific game (from real lineup data, never position-restricted), every
  game in the round must have exactly the sport's required number of selections, and a
  game's selections lock once it's no longer scheduled.
- `src/lib/data/` — typed data-access functions, including `entries.ts` (create an entry,
  settle and persist its results) and `competitions.ts`. Every function returns a
  `DataResult<T>` (`ok` or `unavailable`) instead of throwing, so pages can render proper
  empty/unavailable states.
- `src/app/[sport]/...` — dynamic routes shared by NRL and AFL: round list, round detail,
  game detail, and `rounds/[roundId]/enter` (the selection UI), all driven by
  `src/lib/sports/config.ts`.
- `src/lib/sports-data/` — the provider-agnostic sports-data layer: `provider.ts`
  (`SportsDataProvider` interface), `types.ts` (normalized Season/Round/Game/Team/Player/
  PlayerGameStat), `sync.ts` (idempotent Postgres upserts), `validate.ts` (data-quality
  checks), and `providers/` (a Champion Data boundary placeholder — not functional — and a
  test-only mock provider). See `docs/stage8-sports-data-integration.md` for the full
  design and current provider status.
- `src/lib/auth/` + `src/lib/data/auth.ts` — first-party email/password auth (Node's
  built-in `scrypt`, no external provider) and opaque bearer session tokens, shared by both
  the web app and the mobile app (`sessions` table, hashed tokens only).
- `src/app/api/` — the JSON API boundary the mobile app calls (and the web app could migrate
  to later). Thin wrappers around the same data-access functions the web pages use — no
  business logic lives in a route handler. See `docs/mobile-app-architecture.md`.
- `mobile/` — the Expo (React Native + TypeScript) mobile app. Separate package, own
  `package.json`; talks to this Next.js app's `/api/*` routes over HTTP, never touches the
  database directly. See `docs/mobile-app-architecture.md`.

## Known placeholder / TBD

- **No live sports-data provider is connected.** `src/lib/sports-data/` is built and
  tested against a normalized model and a mock fixture, but `ChampionDataProvider` throws
  on every call — no credentials or API documentation exist yet. See
  `docs/stage8-sports-data-integration.md`.
- **No payment processing.** Entries are created with `paymentStatus: "pending"` and are not
  charged. `competitions.entryFeeCents` / `prizeAmountCents` are configurable data values
  (never hardcoded), ready for a payment integration later. App Store/Google Play IAP
  policy needs a compliance decision first — see `docs/mobile-app-architecture.md` §8.
- **Mobile app is a foundation, not a finished app.** The Expo project exists and can call
  the live API (sport list screen proven end-to-end); the full picks/entry/results UI
  described in the product vision is still to be built as native screens. See
  `docs/mobile-app-architecture.md`.
