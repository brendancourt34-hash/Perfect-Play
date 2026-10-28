import type { SportsDataProvider } from "./provider";
import { getNbaSportsDataConfig, getNflSportsDataConfig, getSportsDataConfig } from "./config";
import { ChampionDataProvider } from "./providers/champion-data-provider";
import { createLifecycleMockProvider, createNflMockProvider } from "./providers/mock-provider";
import { NbaEspnProvider } from "./providers/nba-espn-provider";

export class SportsDataNotConfiguredError extends Error {
  constructor(reason: string) {
    super(`Sports data provider is not configured: ${reason}`);
    this.name = "SportsDataNotConfiguredError";
  }
}

/**
 * The single place any code (a future admin sync action, a scheduled job) asks "which
 * sports-data provider do I sync from?" — Phase 21.
 *
 * Deliberately fails loudly rather than ever silently substituting mock data for real
 * data, or silently doing nothing:
 *  - "none" (the default) throws SportsDataNotConfiguredError — no provider has been
 *    chosen, so there is nothing to sync from.
 *  - "champion-data" returns a real ChampionDataProvider — which itself throws
 *    immediately in its constructor, since no real credentials/API documentation exist
 *    yet (see providers/champion-data-provider.ts). Selecting this name does not fake a
 *    live connection.
 *  - "mock" returns the Phase 21 lifecycle mock fixture — an explicit, named, dev/test-
 *    only opt-in (see providers/mock-provider.ts's own "TEST FIXTURE — NOT A REAL
 *    PROVIDER" warning). This is never selected by default.
 */
export function getSportsDataProvider(): SportsDataProvider {
  const config = getSportsDataConfig();

  if (config.provider === "none") {
    throw new SportsDataNotConfiguredError(
      "SPORTS_DATA_PROVIDER is unset (or \"none\"). Set it to \"mock\" for dev/test fixtures, or \"champion-data\" once real API access is confirmed.",
    );
  }
  if (config.provider === "mock") {
    return createLifecycleMockProvider();
  }
  return new ChampionDataProvider();
}

/**
 * NBA (Phase 22) gets its own resolver rather than sharing getSportsDataProvider(): its
 * real default provider (nba-espn) needs no credentials and no "not configured yet" gate
 * — unlike NRL/AFL's Champion Data, there's no commercial approval being waited on, so
 * defaulting to "throw" here would be actively wrong (it would hide a genuinely working
 * integration behind an unnecessary manual opt-in). NBA_SPORTS_DATA_PROVIDER can still
 * override to "mock" (dev/test fixture) or "none" (explicitly disable) if ever needed.
 */
export function getNbaSportsDataProvider(): SportsDataProvider {
  const config = getNbaSportsDataConfig();

  if (config.provider === "none") {
    throw new SportsDataNotConfiguredError('NBA_SPORTS_DATA_PROVIDER is explicitly set to "none".');
  }
  if (config.provider === "mock") {
    return createLifecycleMockProvider();
  }
  return new NbaEspnProvider();
}

/**
 * NFL (Phase 23F — new sport) gets its own resolver, following the same "not configured
 * yet" pattern as NRL/AFL's Champion Data — never fabricates a real connection. Honest by
 * design: the admin "Sports data provider" status must show NFL as Unconfigured until a
 * real, vetted NFL data source is actually connected. NFL_SPORTS_DATA_PROVIDER=mock opts
 * into the dev/test fixture for local testing.
 */
export function getNflSportsDataProvider(): SportsDataProvider {
  const config = getNflSportsDataConfig();

  if (config.provider === "none") {
    throw new SportsDataNotConfiguredError(
      "NFL_SPORTS_DATA_PROVIDER is unset (or \"none\") — no NFL sports-data source has been connected yet. Set it to \"mock\" for dev/test fixtures.",
    );
  }
  return createNflMockProvider();
}
