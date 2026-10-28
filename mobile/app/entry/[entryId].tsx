import { useCallback, useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as api from "../../lib/api";
import { Card } from "../../components/Card";
import { PerfectBadge } from "../../components/StatusBadge";
import { ResultRow } from "../../components/ResultRow";
import { MomentsList } from "../../components/MomentsList";
import { SectionLabel } from "../../components/SectionLabel";
import { ErrorState, LoadingState } from "../../components/ScreenStates";
import { colors, spacing, typography } from "../../constants/theme";
import { formatStatLabel } from "../../lib/format";
import { isSportSlug, SPORTS } from "../../constants/sports";

const HEADER_COPY: Record<string, { heading: string; description: string }> = {
  perfect: { heading: "PERFECT", description: "You went PERFECT. Congratulations — your entry got every selection correct." },
  not_perfect: { heading: "NOT PERFECT", description: "Not PERFECT this time. You missed the perfect round." },
  pending: { heading: "PENDING", description: "Your round is still in play. Keep watching — your PERFECT result isn't decided yet." },
};

export default function MyEntryScreen() {
  const { entryId: entryIdParam } = useLocalSearchParams<{ entryId: string }>();
  const entryId = Number(entryIdParam);

  const [entry, setEntry] = useState<api.EntryResultDetail | null>(null);
  const [moments, setMoments] = useState<api.PerfectPlayMoment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!Number.isInteger(entryId)) return;
    const result = await api.getEntry(entryId);
    if (result.ok) {
      setEntry(result.data.entry);
      setError(null);

      // The moments feed is keyed by (user, competition) — reading it here shows this
      // round's whole progression story, not just events tied to this one entry ID (a
      // customer's other identical entries in the same competition share the same story).
      const momentsResult = await api.listMoments(result.data.entry.competitionId);
      if (momentsResult.ok) {
        setMoments(momentsResult.data.moments);
        // Global mark-all-read (the API has no per-competition read state, and this app
        // has no separate notifications inbox screen to justify one) — viewing any one
        // round's story is treated as "caught up," a deliberate simplification.
        if (momentsResult.data.moments.some((m) => !m.readAt)) api.markMomentsRead();
      }
    } else {
      setError(result.message);
    }
  }, [entryId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!entry && !error) return <LoadingState label="Loading entry…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!entry) return null;

  const copy = HEADER_COPY[entry.entryResult];
  const sport = isSportSlug(entry.sportCode) ? SPORTS[entry.sportCode] : null;
  const resultLabels = sport && "resultTerms" in sport ? sport.resultTerms : undefined;

  return (
    <FlatList
      style={styles.container}
      data={entry.selections}
      keyExtractor={(s) => String(s.gameId)}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>{copy.heading}</Text>
            <PerfectBadge result={entry.entryResult} labels={resultLabels} />
          </View>
          <Text style={styles.headerDescription}>{copy.description}</Text>
          <Text style={styles.entryMeta}>Entry #{entry.entryId} — no fantasy scoring, no leaderboard.</Text>

          {moments.length > 0 && (
            <View style={styles.momentsSection}>
              <SectionLabel>Perfect Play Moments</SectionLabel>
              <MomentsList moments={moments} />
            </View>
          )}
        </View>
      }
      renderItem={({ item: selection }) => (
        <Card style={styles.gameCard}>
          <View style={styles.gameHeader}>
            <Text style={styles.matchup}>
              {selection.homeTeamName} vs {selection.awayTeamName}
            </Text>
            <PerfectBadge result={selection.gameResult} labels={resultLabels} />
          </View>

          {selection.selections.map((pick) => (
            <ResultRow
              key={pick.id}
              name={pick.name}
              statLine={formatStatLabel(entry.statField, pick.statCount)}
              result={pick.result}
              labels={resultLabels}
            />
          ))}
        </Card>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  header: { marginBottom: spacing.sm },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headerTitle: { ...typography.title, fontSize: 26, color: colors.foreground },
  headerDescription: { color: colors.muted, fontSize: 14, marginTop: spacing.xs },
  entryMeta: { color: colors.muted2, fontSize: 12, marginTop: spacing.xs },
  momentsSection: { marginTop: spacing.lg, gap: spacing.sm },
  gameCard: { gap: spacing.sm },
  gameHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  matchup: { ...typography.subheading, fontSize: 15, color: colors.foreground, flex: 1, marginRight: spacing.sm },
});
