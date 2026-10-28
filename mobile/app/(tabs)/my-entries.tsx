import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as api from "../../lib/api";
import { isSportSlug, SPORTS } from "../../constants/sports";
import { Card } from "../../components/Card";
import { PerfectBadge, SelectionBadge } from "../../components/StatusBadge";
import { ScreenHeader } from "../../components/ScreenHeader";
import { EmptyState, ErrorState, LoadingState } from "../../components/ScreenStates";
import { Icon } from "../../components/icons";
import { Screen } from "../../components/Screen";
import { colors, radius, spacing, typography } from "../../constants/theme";
import { formatAudCents, formatStatLabel } from "../../lib/format";

/**
 * Groups entries by competition/shared-selection-set — "10 ENTRIES, SAME PICKS" — never
 * one row per entry, and never the same picks repeated once per entry. Reuses the exact
 * same grouping as the web My Entries page (GET /api/entries/groups ->
 * listEntryGroupsForUser server-side); no second grouping algorithm exists. Works for any
 * sport's actual selection count (8 for NRL/NBA/NFL, 9 for AFL) — nothing here hard-codes
 * a game count, it renders however many selections the group's own data has.
 */
export default function MyEntriesScreen() {
  const router = useRouter();
  const [groups, setGroups] = useState<api.MyEntryGroup[] | null>(null);
  const [latestMomentByCompetition, setLatestMomentByCompetition] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [groupsResult, momentsResult] = await Promise.all([api.listMyEntryGroups(), api.listMoments()]);
    if (groupsResult.ok) {
      setGroups(groupsResult.data.groups);
      setError(null);
    } else {
      setError(groupsResult.message);
    }
    if (momentsResult.ok) {
      // Moments arrive newest-first — the first one seen per competition is the latest.
      const byCompetition = new Map<number, string>();
      for (const moment of momentsResult.data.moments) {
        if (!byCompetition.has(moment.competitionId)) byCompetition.set(moment.competitionId, moment.message);
      }
      setLatestMomentByCompetition(byCompetition);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Screen style={styles.container}>
      <ScreenHeader title="My Entries" />

      {!groups && !error && <LoadingState label="Loading your entries…" />}
      {error && <ErrorState message={error} onRetry={load} />}
      {groups && groups.length === 0 && (
        <EmptyState title="No entries yet" description="Enter a round from the Home tab to see it here." />
      )}
      {groups && groups.length > 0 && (
        <FlatList
          data={groups}
          keyExtractor={(g) => String(g.competitionId)}
          contentContainerStyle={styles.list}
          renderItem={({ item: group }) => (
            <EntryGroupCard group={group} latestMoment={latestMomentByCompetition.get(group.competitionId)} onPressEntry={(entryId) => router.push(`/entry/${entryId}`)} />
          )}
        />
      )}
    </Screen>
  );
}

function EntryGroupCard({ group, latestMoment, onPressEntry }: { group: api.MyEntryGroup; latestMoment?: string; onPressEntry: (entryId: number) => void }) {
  const sport = isSportSlug(group.sportCode) ? SPORTS[group.sportCode] : null;
  const resultLabels = sport && "resultTerms" in sport ? sport.resultTerms : undefined;
  const entryCount = group.entryIds.length;
  const roundLabel = group.roundName ?? `Round ${group.roundNumber}`;

  return (
    <Card style={styles.groupCard}>
      <View style={styles.groupHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sportLine}>
            {sport?.name ?? group.sportCode.toUpperCase()} — {roundLabel}
          </Text>
          <View style={styles.entryCountRow}>
            <Text style={styles.entryCountText}>
              {entryCount} {entryCount === 1 ? "ENTRY" : "ENTRIES"}
            </Text>
            {entryCount > 1 && (
              <View style={styles.samePicksBadge}>
                <Text style={styles.samePicksText}>SAME PICKS</Text>
              </View>
            )}
          </View>
          {latestMoment && (
            <Text style={styles.momentText} numberOfLines={1}>
              {latestMoment}
            </Text>
          )}
        </View>
        <PerfectBadge result={group.result} labels={resultLabels} />
      </View>

      {group.result === "perfect" && group.totalPrizeAllocationCents > 0 && (
        <View style={styles.wonBox}>
          <Text style={styles.wonTitle}>YOU WON</Text>
          <Text style={styles.wonSubtitle}>
            {entryCount} {entryCount === 1 ? "share" : "shares"}
            {group.competitionWinnerCount > 0 ? ` of ${group.competitionWinnerCount} total PERFECT entries` : ""}
          </Text>
          <Text style={styles.wonAmount}>{formatAudCents(group.totalPrizeAllocationCents)}</Text>
        </View>
      )}

      {group.selections.length > 0 && (
        <View style={styles.picksSection}>
          <Text style={styles.sectionLabel}>Your picks — shared by every entry above</Text>
          {group.selections.map((s, i) => (
            <View key={s.gameId} style={styles.pickRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.gameLabel}>
                  GAME {i + 1} — {s.homeTeamName} vs {s.awayTeamName}
                </Text>
                <Text style={styles.playerName}>{s.playerName ?? "—"}</Text>
                {group.statField && <Text style={styles.statLine}>{formatStatLabel(group.statField, s.statCount)}</Text>}
              </View>
              <SelectionBadge result={s.pickResult} labels={resultLabels} />
            </View>
          ))}
        </View>
      )}

      <View style={styles.entryIdsSection}>
        <Text style={styles.sectionLabel}>Individual entries</Text>
        <View style={styles.entryIdsRow}>
          {group.entryIds.map((entryId) => (
            <Pressable key={entryId} accessibilityRole="button" onPress={() => onPressEntry(entryId)} style={styles.entryIdChip}>
              <Text style={styles.entryIdText}>#{entryId}</Text>
              <Icon name="chevronRight" size={12} color={colors.muted2} />
            </Pressable>
          ))}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  groupCard: { gap: spacing.md },
  groupHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  sportLine: { ...typography.label, color: colors.muted2, textTransform: "uppercase" },
  entryCountRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 4 },
  entryCountText: { ...typography.heading, color: colors.foreground },
  samePicksBadge: { borderWidth: 1, borderColor: colors.brandBorder, backgroundColor: colors.brandSoft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  samePicksText: { color: colors.brand, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  momentText: { color: colors.brand, fontSize: 11, fontWeight: "700", marginTop: 6 },
  wonBox: { borderWidth: 1, borderColor: colors.brandBorder, backgroundColor: colors.brandSoft, borderRadius: radius.md, padding: spacing.md },
  wonTitle: { color: colors.brand, fontSize: 18, fontWeight: "800", textTransform: "uppercase" },
  wonSubtitle: { color: colors.brand, fontSize: 12, marginTop: 2 },
  wonAmount: { color: colors.brand, fontSize: 22, fontWeight: "800", marginTop: 4 },
  picksSection: { gap: spacing.sm },
  sectionLabel: { ...typography.label, color: colors.muted2, textTransform: "uppercase", marginBottom: 2 },
  pickRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.surfaceRaised, borderRadius: 10, padding: spacing.md, gap: spacing.sm },
  gameLabel: { color: colors.muted2, fontSize: 11, fontWeight: "700" },
  playerName: { color: colors.foreground, fontSize: 14, fontWeight: "600", marginTop: 2 },
  statLine: { color: colors.muted2, fontSize: 12, marginTop: 2 },
  entryIdsSection: { gap: spacing.xs },
  entryIdsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  entryIdChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  entryIdText: { color: colors.muted, fontSize: 12, fontWeight: "600" },
});
