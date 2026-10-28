# Settlement load test — isolated environment

The settlement-at-scale scenario (`scripts/loadtest/run.ts`'s `settlement` case) can run
two ways:

## 1. Against the shared dev database (existing behaviour)

```bash
LOAD_TEST_CONFIRM=i-understand-this-is-not-production \
npx dotenv -e .env.local -- npx tsx scripts/loadtest/run.ts settlement nrl 300
```

Uses whatever `DATABASE_URL` your `.env.local` already points at (the shared dev/Neon
database) and the app server already running on `:3000`. Fine for quick, moderate-scale
runs, but this database is shared with everything else you're doing in this environment —
high concurrency here competes with your own dev traffic, and a flaky/rate-limited
connection affects both.

## 2. Against a fully isolated database + app server (recommended for real scale)

`scripts/loadtest/run-isolated.ts` spins up a **separate app server** (its own port, its
own Next build directory) pointed at a **separate database** you provide, runs the exact
same `scenarioSettlement` logic unchanged, then tears the server down. Nothing here ever
touches your real `DATABASE_URL` or the shared dev server.

### Step 1 — get an isolated Postgres connection string

Pick ONE. Never reuse your app's real `DATABASE_URL`.

**Option A — Neon claimable (fastest, no account needed):**

```bash
npx neon@latest claim create --file .env.loadtest.local
# Copy the DATABASE_URL line out of .env.loadtest.local into LOAD_TEST_DATABASE_URL below,
# then delete .env.loadtest.local (it holds real credentials).
```

Expires automatically in 72 hours unless claimed into a real account (`neon claim accept`)
— fine for a one-off load test, don't rely on it persisting.

**Option B — a dedicated Neon branch/project on your own account:**

```bash
neon projects create --name perfect-play-loadtest
# copy the printed connection string
```

**Option C — local Postgres (no network dependency at all, but slower to set up if not
already installed — building Postgres from source via Homebrew can take a long time on
some machines):**

```bash
brew install postgresql@16
brew services start postgresql@16
createdb perfect_play_loadtest
# LOAD_TEST_DATABASE_URL=postgresql://localhost:5432/perfect_play_loadtest
```

Add whichever URL you chose to `.env.local` as `LOAD_TEST_DATABASE_URL` (see
`.env.example` for the exact variable). **It must not equal `DATABASE_URL`** —
`assertSafeLoadTestDatabase` (`scripts/loadtest/db-client.ts`) refuses to run otherwise,
and also refuses any URL whose host/database name contains a "prod"/"production" token.

### Step 2 — push the schema and seed minimal data (once per fresh database)

```bash
LOAD_TEST_DATABASE_URL=postgresql://... npx tsx scripts/loadtest/seed-isolated-db.ts
```

This runs `drizzle-kit push` (see the command's own README note below) then inserts the
same three entry packages (1/5/10) and the `max_entries_per_round` setting the real app
seeds — never different values.

To push the schema directly instead of via the seed script:

```bash
DATABASE_URL="$LOAD_TEST_DATABASE_URL" npx drizzle-kit push --config drizzle.config.ts --force
```

### Step 3 — run it

```bash
LOAD_TEST_CONFIRM=i-understand-this-is-not-production \
LOAD_TEST_DATABASE_URL=postgresql://... \
npx dotenv -e .env.local -- npx tsx scripts/loadtest/run-isolated.ts nrl 1000
```

Arguments: `[sport] [customers]` — e.g. `nrl 5000`, `afl 10000`. Package size (1/5/10)
cycles per customer and roughly 1-in-8 goes PERFECT, matching the shared scenario's
existing design (see `run.ts`'s `scenarioSettlement` doc comment).

### Why a separate app server, not just a separate database?

`scenarioSettlement` drives the real HTTP API (register, buy a package, close, settle) —
those endpoints are served by whichever Next.js process is listening on the port it's
pointed at, and that process reads `DATABASE_URL` from **its own environment**, not from
whatever the test script's own DB client is looking at. Pointing the test script's queries
at an isolated database while still hitting the shared dev server on `:3000` would create
entries against one database while asserting on another. `run-isolated.ts` spawns its own
`next dev` with `DATABASE_URL` overridden to the isolated URL, on its own port, using its
own build directory (`next.config.ts`'s `LOAD_TEST_ISOLATED_DIST_DIR`, since Next refuses
to run two `next dev` processes sharing one `.next` folder) — a genuinely separate app
instance for the whole run, cleaned up automatically when the script exits.

## Safety

`LOAD_TEST_DATABASE_URL` is required and validated (`assertSafeLoadTestDatabase`):

- Unset → refuses to run at all (never silently falls back to the real `DATABASE_URL`).
- Identical to `DATABASE_URL` → refuses to run.
- Host or database name contains a `prod`/`production` token → refuses to run.

`LOAD_TEST_CONFIRM=i-understand-this-is-not-production` is still required on top of this
(the same gate every other load-test scenario already uses — `assertSafeEnvironment`,
`scripts/loadtest/harness.ts`), and every HTTP target is still hard-restricted to
`localhost`/`127.0.0.1`.
