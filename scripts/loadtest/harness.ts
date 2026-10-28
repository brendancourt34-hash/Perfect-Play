/**
 * Reusable load-test harness — Phase 23I. Native fetch + Promise-based concurrency
 * control, no external load-testing dependency (k6/Artillery/etc.) since this project's
 * own convention is TypeScript scripts run via `npx tsx`, and the brief explicitly asks
 * to prefer a tool appropriate to the existing stack.
 *
 * SAFETY: assertSafeEnvironment() is a hard gate every scenario script calls before
 * sending a single request. It refuses to run against anything that isn't an explicit
 * local/non-production URL, and refuses to run at all unless the caller has explicitly
 * set LOAD_TEST_CONFIRM=i-understand-this-is-not-production. This makes it very difficult
 * to accidentally point this at a real deployment.
 */
import { Agent, setGlobalDispatcher } from "undici";

// Node's global `fetch` (undici) defaults to a 300s headers/body timeout. Real settlement
// work at load-test scale (thousands of entries, settleCompetition's real, unmodified,
// intentionally-sequential-per-entry design — see run.ts's scenarioSettlement doc comment)
// can legitimately exceed that in THIS sandbox's degraded per-connection network latency to
// an external database, well before the request itself is unhealthy. Raising the CLIENT's
// patience is a load-test-harness fix (never touches settlement.ts or what it asserts) —
// production's real timeout budget (a platform/CDN limit, not this default) is a separate,
// deliberate decision outside this harness's scope.
setGlobalDispatcher(new Agent({ headersTimeout: 30 * 60_000, bodyTimeout: 30 * 60_000 }));

export interface TaskResult {
  ok: boolean;
  status: number;
  durationMs: number;
  error?: string;
}

export interface LoadResult {
  total: number;
  succeeded: number;
  failed: number;
  errorsByStatus: Record<string, number>;
  durationsMs: number[];
  wallClockMs: number;
  requestsPerSec: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  min: number;
  mean: number;
}

/** Hard safety gate — refuses to run unless the target is unambiguously non-production. */
export function assertSafeEnvironment(baseUrl: string): void {
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    throw new Error(`LOAD TEST SAFETY: "${baseUrl}" is not a valid URL. Refusing to run.`);
  }
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local");
  if (!isLocal) {
    throw new Error(
      `LOAD TEST SAFETY: refusing to run against non-local host "${host}". This harness only ever targets localhost — it must never be pointed at a real deployment. If you genuinely need to load-test a remote staging environment, that requires a deliberate, separate decision outside this harness, not a config flag here.`,
    );
  }
  if (process.env.LOAD_TEST_CONFIRM !== "i-understand-this-is-not-production") {
    throw new Error(
      'LOAD TEST SAFETY: set LOAD_TEST_CONFIRM=i-understand-this-is-not-production in the environment to run load tests. This is deliberately not a default-on flag.',
    );
  }
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function summarize(results: TaskResult[], wallClockMs: number): LoadResult {
  const durationsMs = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const errorsByStatus: Record<string, number> = {};
  for (const r of results) {
    if (!r.ok) {
      const key = r.error ? `error:${r.error}` : `http:${r.status}`;
      errorsByStatus[key] = (errorsByStatus[key] ?? 0) + 1;
    }
  }
  const succeeded = results.filter((r) => r.ok).length;
  return {
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    errorsByStatus,
    durationsMs,
    wallClockMs,
    requestsPerSec: wallClockMs > 0 ? (results.length / wallClockMs) * 1000 : 0,
    p50: percentile(durationsMs, 50),
    p95: percentile(durationsMs, 95),
    p99: percentile(durationsMs, 99),
    max: durationsMs[durationsMs.length - 1] ?? 0,
    min: durationsMs[0] ?? 0,
    mean: durationsMs.length ? durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length : 0,
  };
}

/**
 * Runs `count` tasks with at most `concurrency` in flight at once — a simple worker-pool,
 * not a fixed-batch-then-wait loop, so slower requests don't stall faster ones behind them.
 */
export async function runConcurrent(count: number, concurrency: number, task: (i: number) => Promise<TaskResult>): Promise<LoadResult> {
  const results: TaskResult[] = new Array(count);
  let nextIndex = 0;
  const start = Date.now();

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= count) return;
      results[i] = await task(i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, count) }, () => worker());
  await Promise.all(workers);
  return summarize(results, Date.now() - start);
}

/**
 * Runs `count` tasks paced at a target rate (requests/sec), rather than all-at-once —
 * models a realistic ARRIVAL RATE (Scenario A/B: distributed load over a window) as
 * opposed to a pure concurrency burst (Scenario C). Still allows up to `maxConcurrency`
 * requests in flight at once so a slow request doesn't block the pacing of new arrivals.
 */
export async function runPaced(count: number, requestsPerSec: number, maxConcurrency: number, task: (i: number) => Promise<TaskResult>): Promise<LoadResult> {
  const results: TaskResult[] = new Array(count);
  const intervalMs = 1000 / requestsPerSec;
  const start = Date.now();
  let inFlight = 0;
  let launched = 0;
  let resolveDone: () => void;
  const done = new Promise<void>((resolve) => (resolveDone = resolve));

  function maybeFinish() {
    if (launched >= count && inFlight === 0) resolveDone();
  }

  function launchNext(i: number) {
    inFlight++;
    task(i)
      .then((r) => {
        results[i] = r;
      })
      .catch((e) => {
        results[i] = { ok: false, status: 0, durationMs: 0, error: e instanceof Error ? e.message : String(e) };
      })
      .finally(() => {
        inFlight--;
        maybeFinish();
      });
  }

  for (let i = 0; i < count; i++) {
    while (inFlight >= maxConcurrency) {
      await new Promise((r) => setTimeout(r, 5));
    }
    launched++;
    launchNext(i);
    if (i < count - 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  maybeFinish();
  await done;
  return summarize(results, Date.now() - start);
}

/**
 * Retries a transient-failure-prone operation a few times with backoff — for direct DB
 * calls the load-test script itself makes in a long SEQUENTIAL loop (unlike timedFetch,
 * which already never throws and is used for the HTTP requests actually under test). This
 * sandbox's network path to an isolated Neon database has shown occasional transient
 * connect timeouts purely as a function of how many sequential round-trips a loop makes —
 * a load-test-environment reliability concern, never a reason to change what the operation
 * itself does or asserts.
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4, baseDelayMs = 300): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastError;
}

/**
 * Runs `count` independent async tasks with at most `concurrency` in flight — for direct,
 * per-row DB writes a load-test script makes itself (e.g. funding one wallet per customer)
 * where each task touches a disjoint row, so there is no race to guard against and a
 * strictly sequential loop only adds unnecessary wall-clock time (particularly painful
 * against a network-distant database — see harness.ts's withRetry doc comment). Unlike
 * runConcurrent, tasks here return their own value rather than a TaskResult; a task that
 * throws propagates immediately, same as it would from a sequential loop.
 */
export async function mapWithConcurrency<T>(count: number, concurrency: number, task: (i: number) => Promise<T>): Promise<T[]> {
  const results: T[] = new Array(count);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= count) return;
      results[i] = await task(i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, count) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Times a single fetch call and normalizes it into a TaskResult, never throwing. */
export async function timedFetch(url: string, init?: RequestInit): Promise<TaskResult & { body?: unknown }> {
  const start = Date.now();
  try {
    const res = await fetch(url, init);
    const durationMs = Date.now() - start;
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    return { ok: res.ok, status: res.status, durationMs, body };
  } catch (e) {
    return { ok: false, status: 0, durationMs: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
  }
}

export function formatResult(label: string, r: LoadResult): string {
  const errLines = Object.entries(r.errorsByStatus)
    .map(([k, v]) => `      ${k}: ${v}`)
    .join("\n");
  return [
    `--- ${label} ---`,
    `  total: ${r.total}   succeeded: ${r.succeeded}   failed: ${r.failed}   (${((r.succeeded / r.total) * 100).toFixed(1)}% success)`,
    `  wall clock: ${r.wallClockMs}ms   throughput: ${r.requestsPerSec.toFixed(1)} req/s`,
    `  latency (ms) — min:${r.min} p50:${r.p50} p95:${r.p95} p99:${r.p99} max:${r.max} mean:${r.mean.toFixed(1)}`,
    errLines ? `  errors:\n${errLines}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
