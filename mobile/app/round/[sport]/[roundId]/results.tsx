import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as api from "../../../../lib/api";
import { isSportSlug, SPORTS } from "../../../../constants/sports";
import { Card } from "../../../../components/Card";
import { SectionLabel } from "../../../../components/SectionLabel";
import { CompetitionStateBadge } from "../../../../components/StatusBadge";
import { Icon } from "../../../../components/icons";
import { EmptyState, ErrorState, LoadingState } from "../../../../components/ScreenStates";
import { colors, spacing, typography, font } from "../../../../constants/theme";
import { formatAudCents } from "../../../../lib/format";

export default function ResultsScreen() {
  const { sport: sportParam, roundId: roundIdParam } = useLocalSearchParams<{ sport: string; roundId: string }>();
  const sportSlug = isSportSlug(sportParam) ? sportParam : null;
  const roundId = Number(roundIdParam);

  const [data, setData] = useState<api.CompetitionResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sportSlug || !Number.isInteger(roundId)) return;
    const result = await api.getResults(sportSlug, roundId);
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else {
      setError(result.message);
    }
  }, [sportSlug, roundId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!sportSlug) return <ErrorState message="Unknown sport." />;
  const sport = SPORTS[sportSlug];

  if (!data && !error) return <LoadingState label="Loading results…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data?.competition || !data.results) {
    return <EmptyState title="No entries yet" description="No one has entered this round yet." />;
  }

  const { competition, results } = data;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{sport.name} Results</Text>
      <CompetitionStateBadge state={competition.state} />

      {/* No entrant count, live turnover, or live payout estimate is ever shown here —
          only the Prize Pool state itself until the competition actually settles. */}
      <Card style={styles.prizeCard}>
        <Icon name="trophy" size={20} color={colors.brandText} />
        <View style={{ flex: 1 }}>
          <Text style={styles.prizeLabel}>Prize Pool</Text>
          <Text style={styles.prizeValue}>{results.currentPrizePoolCents !== null ? formatAudCents(results.currentPrizePoolCents) : sport.revealPhrase}</Text>
        </View>
      </Card>

      {results.myPerfectEntryCount > 0 && (
        <Card style={styles.wonCard}>
          <Text style={styles.wonTitle}>You Won</Text>
          <Text style={styles.wonSubtitle}>
            {results.myPerfectEntryCount} {results.myPerfectEntryCount === 1 ? "share" : "shares"} of the Prize Pool
          </Text>
          <Text style={styles.wonAmount}>{formatAudCents(results.mySharesAmountCents)}</Text>
        </Card>
      )}

      <SectionLabel>Winners</SectionLabel>
      {!results.settled ? (
        <Text style={styles.mutedText}>Results aren&apos;t final yet — check back once every game in the round has finished.</Text>
      ) : results.perfectCount === 0 ? (
        <Text style={styles.mutedText}>NO PERFECT ENTRIES. THE PRIZE POOL ROLLS OVER TO THE NEXT ROUND.</Text>
      ) : (
        <>
          <Text style={styles.mutedText}>
            {results.perfectCount} PERFECT {results.perfectCount === 1 ? "ENTRY" : "ENTRIES"}
            {results.payoutPerPerfectEntryCents !== null ? ` — ${formatAudCents(results.payoutPerPerfectEntryCents)} PER PERFECT ENTRY` : ""}.{" "}
            {results.perfectCount! > 1 ? "More than one entry went PERFECT, so the pool is split evenly." : ""}
          </Text>
          <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
            {results.perfectEntryIds.map((id) => (
              <View key={id} style={styles.winnerRow}>
                <Icon name="trophy" size={14} color={colors.brandText} />
                <Text style={styles.winnerText}>Entry #{id}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  title: { ...typography.title, fontSize: 24, color: colors.foreground },
  prizeCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.sm },
  prizeLabel: { color: colors.muted, fontSize: 14 },
  prizeValue: { color: colors.foreground, fontSize: 20, fontFamily: font.w800 },
  wonCard: { marginTop: spacing.sm, borderColor: colors.brandBorder, backgroundColor: colors.brandSoft },
  wonTitle: { color: colors.brandText, fontSize: 20, fontFamily: font.w800, textTransform: "uppercase" },
  wonSubtitle: { color: colors.brandText, fontSize: 13, marginTop: 2 },
  wonAmount: { color: colors.brandText, fontSize: 24, fontFamily: font.w800, marginTop: 4 },
  mutedText: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  winnerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.brandBorder,
    borderRadius: 10,
    padding: spacing.md,
  },
  winnerText: { color: colors.brandText, fontSize: 14, fontFamily: font.w700 },
});
