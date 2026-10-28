import { EmptyState } from "./empty-state";

/**
 * Shown wherever a page needs live sports data that isn't connected yet.
 * Deliberately distinct from a generic "no results" empty state so it's
 * clear this is a missing data source, not an empty round.
 */
export function DataUnavailable({ context }: { context: string }) {
  return (
    <EmptyState
      title="Live data not connected yet"
      description={`${context} will appear here once Perfect Play is connected to a sports data source. No results are shown until then.`}
    />
  );
}
