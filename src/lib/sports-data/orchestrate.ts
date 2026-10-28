import type { SportsDataProvider } from "./provider";
import {
  syncGamePlayers,
  syncGames,
  syncPlayerGameStats,
  syncPlayers,
  syncRounds,
  syncSeasons,
  syncTeams,
  type SyncSummary,
} from "./sync";
import { logEvent } from "@/lib/monitoring/log";

export interface FullSyncSummary {
  provider: string;
  seasons: SyncSummary;
  teams: SyncSummary;
  players: SyncSummary;
  rounds: SyncSummary;
  games: SyncSummary;
  gamePlayers: SyncSummary;
  playerGameStats: SyncSummary;
}

function mergeSummaries(summaries: SyncSummary[]): SyncSummary {
  return summaries.reduce(
    (acc, s) => ({
      inserted: acc.inserted + s.inserted,
      updated: acc.updated + s.updated,
      errors: [...acc.errors, ...s.errors],
      selectionsVoided: acc.selectionsVoided + s.selectionsVoided,
    }),
    { inserted: 0, updated: 0, errors: [] as string[], selectionsVoided: 0 },
  );
}

/**
 * Chains the existing idempotent sync functions (sync.ts) in the one sensible order —
 * season → teams → players → rounds → games → game-player associations → stats — for one
 * sport's one round. This is the "architecture for future scheduled synchronization"
 * Phase 21 asks for: it doesn't require an actual cron provider to exist yet (see
 * docs/phase21-sports-data-and-round-lifecycle.md §Live Data Sync Architecture) — it's a
 * plain function any caller can invoke: a Vercel Cron handler, an external scheduler, or
 * (today) the admin manual sync action (src/app/api/admin/sports-data/sync/route.ts).
 *
 * Every step reuses the same provider instance and the same real, idempotent upserts —
 * running this twice never duplicates data. If an earlier step fails outright (e.g. the
 * season doesn't exist yet), later steps naturally report their own "hasn't been synced
 * yet" errors rather than crashing, exactly as calling the underlying functions manually
 * in the wrong order already would.
 */
export async function runFullSync(
  provider: SportsDataProvider,
  sportCode: string,
  seasonExternalId: string,
  roundExternalId: string,
): Promise<FullSyncSummary> {
  logEvent("sports_data_sync_started", { provider: provider.name, sportCode, seasonExternalId, roundExternalId });
  try {
    const seasons = await syncSeasons(provider, sportCode);
    const teams = await syncTeams(provider, sportCode);

    const teamRecords = await provider.listTeams(sportCode);
    const playerSummaries = await Promise.all(teamRecords.map((t) => syncPlayers(provider, sportCode, t.externalId)));
    const players = mergeSummaries(playerSummaries);

    const rounds = await syncRounds(provider, seasonExternalId);
    const games = await syncGames(provider, roundExternalId);

    const gameRecords = await provider.listGames(roundExternalId);
    const gamePlayerSummaries = await Promise.all(gameRecords.map((g) => syncGamePlayers(provider, sportCode, g.externalId)));
    const gamePlayers = mergeSummaries(gamePlayerSummaries);
    const statSummaries = await Promise.all(gameRecords.map((g) => syncPlayerGameStats(provider, g.externalId)));
    const playerGameStats = mergeSummaries(statSummaries);

    const allErrors = [...seasons.errors, ...teams.errors, ...players.errors, ...rounds.errors, ...games.errors, ...gamePlayers.errors, ...playerGameStats.errors];
    if (allErrors.length > 0) {
      logEvent("provider_sync_failed", { provider: provider.name, sportCode, errorCount: allErrors.length, firstError: allErrors[0] }, "warn");
    } else {
      logEvent("sports_data_sync_completed", { provider: provider.name, sportCode, seasonExternalId, roundExternalId });
    }

    return { provider: provider.name, seasons, teams, players, rounds, games, gamePlayers, playerGameStats };
  } catch (error) {
    logEvent("provider_sync_failed", { provider: provider.name, sportCode, message: error instanceof Error ? error.message : String(error) }, "error");
    throw error;
  }
}
