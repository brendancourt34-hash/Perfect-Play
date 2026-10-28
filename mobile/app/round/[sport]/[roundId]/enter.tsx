import { useCallback, useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as api from "../../../../lib/api";
import { isSportSlug, SPORTS } from "../../../../constants/sports";
import { useEntryDraft } from "../../../../lib/entry-draft-context";
import { Card } from "../../../../components/Card";
import { Button } from "../../../../components/Button";
import { ProgressBar } from "../../../../components/ProgressBar";
import { PlayerPickRow } from "../../../../components/PlayerPickRow";
import { PlayerPickerSheet, type PickablePlayer } from "../../../../components/PlayerPickerSheet";
import { EmptyState, ErrorState, LoadingState } from "../../../../components/ScreenStates";
import { colors, spacing, typography } from "../../../../constants/theme";
import { formatSelectionTarget } from "../../../../lib/format";

type PickerTarget = { gameId: number } | null;

export default function EnterPicksScreen() {
  const { sport: sportParam, roundId: roundIdParam } = useLocalSearchParams<{ sport: string; roundId: string }>();
  const router = useRouter();
  const sportSlug = isSportSlug(sportParam) ? sportParam : null;
  const roundId = Number(roundIdParam);

  const { picks, setPick, isGameComplete, completeCount, roundDetail, setRoundDetail } = useEntryDraft();
  const [error, setError] = useState<string | null>(null);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);

  const load = useCallback(async () => {
    if (!sportSlug || !Number.isInteger(roundId)) return;
    const result = await api.getRoundDetail(sportSlug, roundId);
    if (result.ok) {
      setRoundDetail(result.data);
      setError(null);
    } else {
      setError(result.message);
    }
  }, [sportSlug, roundId, setRoundDetail]);

  useEffect(() => {
    // Reuse the cached round detail set by the round-detail screen if it's already
    // there; otherwise fetch once (e.g. deep-linking straight into /enter).
    if (!roundDetail) load();
  }, [roundDetail, load]);

  if (!sportSlug) return <ErrorState message="Unknown sport." />;
  const sport = SPORTS[sportSlug];

  if (!roundDetail && !error) return <LoadingState label="Loading games…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!roundDetail) return null;

  const openGames = roundDetail.games.filter((g) => g.status === "scheduled");
  const gameIds = openGames.map((g) => g.id);
  const complete = completeCount(gameIds);
  const allComplete = openGames.length > 0 && complete === openGames.length;

  function findPlayer(gameId: number, playerId: number | undefined): PickablePlayer | undefined {
    if (!playerId || !roundDetail) return undefined;
    const game = roundDetail.games.find((g) => g.id === gameId);
    const player = game?.eligiblePlayers.find((p) => p.id === playerId);
    if (!player || !game) return undefined;
    const teamName = player.teamId === game.homeTeam.id ? game.homeTeam.name : game.awayTeam.name;
    return { ...player, teamName };
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Build your PERFECT ROUND</Text>
        <Text style={styles.headerSubtitle}>{sport.pickLabel} Get every pick right to go PERFECT.</Text>
      </View>
      {openGames.length > 0 && <ProgressBar label={`${complete}/${openGames.length} games complete`} complete={complete} total={openGames.length} />}

      {openGames.length === 0 ? (
        <EmptyState title="No games available to pick" description="Every game in this round has already started." />
      ) : (
        <FlatList
          data={openGames}
          keyExtractor={(g) => String(g.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item: game }) => {
            const gameComplete = isGameComplete(game.id);
            const player = findPlayer(game.id, picks[game.id]);
            const roleNoun = roundDetail.selectionLabel;
            const target = formatSelectionTarget(roundDetail.ruleConfig.selectionMetric, roundDetail.ruleConfig.threshold);
            return (
              <Card style={styles.gameCard} highlighted={gameComplete}>
                <Text style={styles.matchup}>
                  {game.homeTeam.name} vs {game.awayTeam.name}
                </Text>
                <Text style={styles.pickPrompt}>
                  {roleNoun} · <Text style={styles.pickTarget}>{target}</Text>
                </Text>
                <PlayerPickRow
                  label={roleNoun}
                  player={player ?? null}
                  accessibilityLabel={player ? `${roleNoun}: ${player.name}, change` : `Select ${roleNoun.toLowerCase()}`}
                  onPress={() => setPickerTarget({ gameId: game.id })}
                />
              </Card>
            );
          }}
        />
      )}

      <View style={styles.footer}>
        <Button
          label={allComplete ? "Review picks" : `Complete all games (${complete}/${openGames.length})`}
          disabled={!allComplete}
          onPress={() => router.push(`/round/${sportSlug}/${roundId}/review`)}
        />
      </View>

      {pickerTarget && roundDetail && (
        <PlayerPickerSheet
          visible
          title={`${roundDetail.selectionLabel} — Game ${openGames.findIndex((g) => g.id === pickerTarget.gameId) + 1}`}
          players={roundDetail.games
            .find((g) => g.id === pickerTarget.gameId)!
            .eligiblePlayers.map((p) => {
              const game = roundDetail.games.find((g) => g.id === pickerTarget.gameId)!;
              return { ...p, teamName: p.teamId === game.homeTeam.id ? game.homeTeam.name : game.awayTeam.name };
            })}
          excludePlayerId={null}
          onSelect={(playerId) => setPick(pickerTarget.gameId, playerId)}
          onClose={() => setPickerTarget(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs },
  headerTitle: { ...typography.subheading, color: colors.foreground },
  headerSubtitle: { color: colors.muted, fontSize: 12, marginTop: 2 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  gameCard: { gap: spacing.sm },
  matchup: { ...typography.subheading, color: colors.foreground },
  pickPrompt: { color: colors.muted, fontSize: 12, marginBottom: spacing.xs },
  pickTarget: { color: colors.brand, fontWeight: "700" },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
});
