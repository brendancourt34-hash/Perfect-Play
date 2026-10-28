import type { SportsDataProvider } from "../provider";

/**
 * Champion Data adapter — BOUNDARY / PLACEHOLDER ONLY.
 *
 * Perfect Play submitted a commercial enquiry to Champion Data (see docs/stage4 and
 * docs/stage8-sports-data-integration.md) and has not yet received API documentation,
 * credentials, or confirmation of commercial terms. This class exists purely to define
 * *where* a real Champion Data adapter will plug into the SportsDataProvider interface —
 * it does not call any Champion Data endpoint, does not assume any authentication scheme,
 * and does not fabricate a response shape.
 *
 * Every method throws deliberately. Once Champion Data access is confirmed, replace each
 * method body with real HTTP calls against their documented API and the actual field
 * mappings from their schema — do not attempt to guess the shape in the meantime.
 */
export class ChampionDataProvider implements SportsDataProvider {
  readonly name = "champion-data";

  constructor() {
    throw new NotYetAvailableError(
      "Champion Data API access has not been granted yet. Do not instantiate this provider until " +
        "credentials and API documentation are confirmed — see docs/stage8-sports-data-integration.md §3/§10.",
    );
  }

  listSeasons(): never {
    throw new NotYetAvailableError("ChampionDataProvider.listSeasons");
  }
  listRounds(): never {
    throw new NotYetAvailableError("ChampionDataProvider.listRounds");
  }
  listTeams(): never {
    throw new NotYetAvailableError("ChampionDataProvider.listTeams");
  }
  listPlayers(): never {
    throw new NotYetAvailableError("ChampionDataProvider.listPlayers");
  }
  listGames(): never {
    throw new NotYetAvailableError("ChampionDataProvider.listGames");
  }
  listGamePlayers(): never {
    throw new NotYetAvailableError("ChampionDataProvider.listGamePlayers");
  }
  listPlayerGameStats(): never {
    throw new NotYetAvailableError("ChampionDataProvider.listPlayerGameStats");
  }
}

export class NotYetAvailableError extends Error {
  constructor(method: string) {
    super(
      `${method} is not implemented: awaiting Champion Data API documentation/credentials. ` +
        "This is a deliberate placeholder, not a bug — see docs/stage8-sports-data-integration.md.",
    );
    this.name = "NotYetAvailableError";
  }
}
