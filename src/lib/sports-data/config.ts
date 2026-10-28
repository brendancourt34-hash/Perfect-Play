/**
 * Server-side sports-data provider configuration. Mirrors the payments config/registry
 * split (src/lib/payments/config.ts) for the same reason: which provider is active must
 * be a server-only decision, never influenced by a client request, and a misconfiguration
 * must be loud rather than a silent fallback to fabricated data.
 *
 * Champion Data (NRL/AFL) has not been connected — Perfect Play has submitted a commercial
 * enquiry but has no API documentation or credentials yet (see
 * docs/stage8-sports-data-integration.md and docs/phase21-sports-data-and-round-lifecycle.md).
 * Selecting "champion-data" here does not make it real; ChampionDataProvider itself
 * refuses to be constructed until real credentials exist.
 *
 * NBA (Phase 22) is different: "nba-espn" is a genuinely live, real, keyless public API
 * (see providers/nba-espn-provider.ts) — there is no commercial gate to wait on, so it is
 * the actual default for the "nba" sport rather than "none". It can still be overridden
 * (e.g. to "mock" for testing) via NBA_SPORTS_DATA_PROVIDER.
 */
export type SportsDataProviderName = "none" | "mock" | "champion-data" | "nba-espn";

export interface SportsDataConfig {
  /** Defaults "none". "mock" is an explicit, clearly-labelled dev/test opt-in — never real data. */
  provider: SportsDataProviderName;
}

/** NRL/AFL provider selection — unchanged from Phase 21. */
export function getSportsDataConfig(): SportsDataConfig {
  const raw = process.env.SPORTS_DATA_PROVIDER;
  const provider: SportsDataProviderName = raw === "mock" ? "mock" : raw === "champion-data" ? "champion-data" : "none";
  return { provider };
}

/** NBA provider selection — defaults to the real, live, keyless ESPN provider. */
export function getNbaSportsDataConfig(): SportsDataConfig {
  const raw = process.env.NBA_SPORTS_DATA_PROVIDER;
  const provider: SportsDataProviderName = raw === "mock" ? "mock" : raw === "none" ? "none" : "nba-espn";
  return { provider };
}

/**
 * NFL provider selection (Phase 23F — new sport). No production NFL data source has been
 * vetted or connected yet — this follows the same honest "none by default" pattern as
 * NRL/AFL's Champion Data (never NBA's "always-on" pattern, since there is no equivalent
 * keyless/no-commercial-gate NFL source to default to). Selecting "none" means the admin
 * "Sports data provider" status must show NFL as Unconfigured rather than fabricating a
 * connection — see getNflSportsDataProvider below.
 */
export function getNflSportsDataConfig(): SportsDataConfig {
  const raw = process.env.NFL_SPORTS_DATA_PROVIDER;
  const provider: SportsDataProviderName = raw === "mock" ? "mock" : "none";
  return { provider };
}
