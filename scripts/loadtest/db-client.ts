/**
 * A SEPARATE database client for the settlement load test only — never used by the
 * application itself (src/db/index.ts is untouched). This exists because
 * @neondatabase/serverless's `neon()` speaks Neon's proprietary SQL-over-HTTP protocol,
 * which only works against an actual Neon-hosted endpoint; a plain local Postgres
 * instance (e.g. `brew install postgresql`) speaks the standard Postgres wire protocol
 * and needs the standard `pg`/`drizzle-orm/node-postgres` client instead. Both clients
 * are pointed at the exact same schema (src/db/schema.ts) — this is a second DRIVER for
 * the load-test tool, never a second data model or a second set of business rules.
 *
 * SAFETY: this module's whole reason to exist is Feature 4's explicit requirement —
 * "never run load tests against a production database" and "do not use the flaky
 * production/dev Neon database by default." See assertSafeLoadTestDatabase.
 */
import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/db/schema";

/** Checks for a "prod"/"production" TOKEN (split on any non-alphanumeric separator) rather than a raw substring — catches "perfect_play_production" and "my-production-db" alike, without false-flagging something like "reproduce" or "productive". */
function looksLikeProduction(haystack: string): boolean {
  const tokens = haystack.toLowerCase().split(/[^a-z0-9]+/);
  return tokens.includes("prod") || tokens.includes("production");
}

/**
 * Refuses to run unless LOAD_TEST_DATABASE_URL is an explicit, different-from-the-real-app
 * connection string with no obvious "this is production" markers. Never a default-on
 * fallback to DATABASE_URL — an unset LOAD_TEST_DATABASE_URL is always a hard refusal, not
 * "assume it's fine to reuse the dev database."
 */
export function assertSafeLoadTestDatabase(loadTestUrl: string | undefined, realDatabaseUrl: string | undefined): asserts loadTestUrl is string {
  if (!loadTestUrl) {
    throw new Error(
      "LOAD_TEST_DATABASE_URL is not set. Refusing to run the settlement load test against the application's shared " +
        "DATABASE_URL (used by local development, and potentially production). Set LOAD_TEST_DATABASE_URL to an " +
        "explicit, disposable Postgres instance — see scripts/loadtest/README.md for setup options (a local Homebrew " +
        "Postgres instance, or a dedicated Neon branch created just for load testing).",
    );
  }
  if (realDatabaseUrl && loadTestUrl.trim() === realDatabaseUrl.trim()) {
    throw new Error(
      "LOAD_TEST_DATABASE_URL is identical to DATABASE_URL. Refusing to run a destructive, high-volume load test " +
        "against the same database real customers/developers use. Point LOAD_TEST_DATABASE_URL at a separate instance.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(loadTestUrl);
  } catch {
    throw new Error(`LOAD_TEST_DATABASE_URL "${loadTestUrl}" is not a valid connection URL.`);
  }
  const haystack = `${parsed.hostname}${parsed.pathname}`;
  if (looksLikeProduction(haystack)) {
    throw new Error(
      `LOAD_TEST_DATABASE_URL "${loadTestUrl}" looks like it may point at a production database (matched "prod"/"production" in the host or database name). Refusing to run — use an explicitly-named test/load-test database instead.`,
    );
  }
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

/**
 * Retries the neon-http driver's own HTTP transport on transient connection failures —
 * this sandbox's outbound path to a Neon isolated/claimable endpoint has shown occasional
 * `ConnectTimeoutError`s (the connection attempt itself times out before any request bytes
 * are sent, per undici), unrelated to load or to any particular query. Safe to retry
 * because a connect-phase failure means the server never received the request at all.
 * This is a transport-level fix for the LOAD-TEST client only (never imported by the real
 * app) — it changes nothing about what is queried, asserted, or settled.
 */
async function retryingFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  // 8 attempts with backoff capped at 8s: this sandbox has shown both quick connect
  // timeouts AND longer-lived DNS-resolution blips (getaddrinfo ENOTFOUND) lasting several
  // seconds — the original 4-attempt/~2s budget was enough for the former but not the
  // latter. Still purely transport-level: never changes what's queried or asserted.
  const attempts = 8;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fetch(input, init);
    } catch (e) {
      lastError = e;
      if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, Math.min(300 * 2 ** attempt, 8000)));
    }
  }
  throw lastError;
}

export type LoadTestDb = ReturnType<typeof drizzleNeonHttp<typeof schema>> | ReturnType<typeof drizzleNodePostgres<typeof schema>>;

let _db: LoadTestDb | null = null;
let _pool: InstanceType<typeof Pool> | null = null;

/**
 * Resolves LOAD_TEST_DATABASE_URL to the right drizzle client for whatever kind of
 * Postgres it actually points at — a plain `postgresql://localhost...` instance gets the
 * standard `pg` driver; anything else is assumed to be a real Neon endpoint (e.g. a
 * dedicated test branch) and gets the existing neon-http driver, exactly like the
 * application itself uses. Same schema either way.
 */
export function getLoadTestDb(): LoadTestDb {
  if (_db) return _db;
  const url = process.env.LOAD_TEST_DATABASE_URL;
  assertSafeLoadTestDatabase(url, process.env.DATABASE_URL);

  const parsed = new URL(url);
  if (isLocalHost(parsed.hostname)) {
    _pool = new Pool({ connectionString: url });
    _db = drizzleNodePostgres(_pool, { schema });
  } else {
    neonConfig.fetchFunction = retryingFetch;
    _db = drizzleNeonHttp(neon(url), { schema });
  }
  return _db;
}

/** Closes the underlying connection pool (only meaningful for the node-postgres path — the neon-http path has no persistent connection to close). Call once at the very end of a load-test run so the process can exit cleanly. */
export async function closeLoadTestDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
  _db = null;
}
