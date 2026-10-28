/**
 * Every data-access function returns one of these instead of throwing, so
 * pages can render a proper empty/unavailable state rather than crashing
 * when no database is connected yet or a query legitimately finds nothing.
 */
export type DataResult<T> =
  | { status: "ok"; data: T }
  | { status: "unavailable"; message: string };

export function ok<T>(data: T): DataResult<T> {
  return { status: "ok", data };
}

export function unavailable<T>(message: string): DataResult<T> {
  return { status: "unavailable", message };
}

/** Runs a DB query and turns connection/config errors into an "unavailable" result. */
export async function safeQuery<T>(fn: () => Promise<T>): Promise<DataResult<T>> {
  try {
    const data = await fn();
    return ok(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error while loading data.";
    return unavailable(message);
  }
}
