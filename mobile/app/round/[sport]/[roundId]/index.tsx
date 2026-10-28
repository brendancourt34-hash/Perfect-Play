import { useCallback, useEffect, useState } from "react";
import { FlatList, SectionList, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as api from "../../../../lib/api";
import { isSportSlug, SPORTS } from "../../../../constants/sports";
import { Card } from "../../../../components/Card";
import { Button } from "../../../../components/Button";
import { GameCard } from "../../../../components/GameCard";
import { InfoRow } from "../../../../components/InfoRow";
import { SectionLabel } from "../../../../components/SectionLabel";
import { CompetitionStateBadge } from "../../../../components/StatusBadge";
import { EmptyState, ErrorState, LoadingState } from "../../../../components/ScreenStates";
import { colors, spacing, typography } from "../../../../constants/theme";
import { formatAudCents, formatAuDateTime } from "../../../../lib/format";

export default function RoundDetailScreen() {
  const { sport: sportParam, roundId: roundIdParam } = useLocalSearchParams<{ sport: string; roundId: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<api.RoundDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sportSlug = isSportSlug(sportParam) ? sportParam : null;
  const roundId = Number(roundIdParam);

  const load = useCallback(async () => {
    if (!sportSlug || !Number.isInteger(roundId)) return;
    const result = await api.getRoundDetail(sportSlug, roundId);
    if (result.ok) {
      setDetail(result.data);
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

  // Games are grouped into day sections only when the round was curated that way (NBA's
  // Thursday-Sunday structure) — a round with no slotLabel set (NRL/AFL, and any
  // non-day-structured round) renders as a flat list exactly as before. The game/pick
  // counts below are always computed from the round's ACTUAL games — never a fixed
  // "8"/"16" — so a 6-game NRL round (e.g. a State of Origin week) shows correctly too.
  const DAY_ORDER = ["thursday", "friday", "saturday", "sunday"];
  const hasDaySlots = detail?.games.some((g) => g.slotLabel) ?? false;
  const daySections = hasDaySlots
    ? Object.entries(
        detail!.games.reduce<Record<string, api.RoundDetail["games"]>>((acc, g) => {
          const key = g.slotLabel ?? "other";
          (acc[key] ??= []).push(g);
          return acc;
        }, {}),
      )
        .sort(([a], [b]) => {
          const ai = DAY_ORDER.indexOf(a);
          const bi = DAY_ORDER.indexOf(b);
          return (ai === -1 ? DAY_ORDER.length : ai) - (bi === -1 ? DAY_ORDER.length : bi);
        })
        .map(([key, data]) => ({
          title: key[0].toUpperCase() + key.slice(1),
          data: [...data].sort((a, b) => (a.kickoff ? new Date(a.kickoff).getTime() : 0) - (b.kickoff ? new Date(b.kickoff).getTime() : 0)),
        }))
    : [];

  const header = detail && (
    <View style={styles.header}>
      <Text style={styles.title}>
        {sport.name} — {detail.round.name ?? `Round ${detail.round.roundNumber}`}
      </Text>
      <View style={styles.badgeRow}>
        <CompetitionStateBadge state={detail.competition.state} />
      </View>
      <Text style={styles.summaryLine}>
        {detail.games.length} Games · {detail.games.length * detail.ruleConfig.selectionsPerGame} Player Picks · {detail.selectionLabel}
      </Text>

      <Card style={styles.infoCard}>
        <InfoRow label="Entry fee" value={formatAudCents(detail.competition.entryFeeCents)} emphasize />
        <InfoRow
          label="Prize"
          value={detail.competition.prizePoolVisible && detail.competition.currentPrizePoolCents !== null ? formatAudCents(detail.competition.currentPrizePoolCents) : sport.revealPhrase}
        />
        {detail.competition.opensAt && <InfoRow label="Opens" value={formatAuDateTime(detail.competition.opensAt)} />}
        {detail.competition.closesAt && <InfoRow label="Closes" value={formatAuDateTime(detail.competition.closesAt)} />}
      </Card>

      {/* The server is authoritative — this button only appears when the API says
          the competition is open; a closed/not-yet-open state never renders it,
          and entry creation independently re-checks this server-side regardless. */}
      {detail.competition.state === "open" && detail.games.length > 0 && (
        <Button
          label={`ENTER PERFECT PLAY — ${formatAudCents(detail.competition.entryFeeCents)}`}
          onPress={() => router.push(`/round/${sportSlug}/${roundId}/buy-in`)}
          style={{ marginTop: spacing.lg }}
        />
      )}
      {detail.competition.state === "not_yet_open" && (
        <Text style={styles.stateNote}>Entries open {detail.competition.opensAt ? formatAuDateTime(detail.competition.opensAt) : "soon"}.</Text>
      )}
      {detail.competition.state === "closed" && <Text style={styles.stateNote}>Entries are closed for this round.</Text>}
      {detail.competition.state === "settled" && (
        <Button label="View results" variant="secondary" onPress={() => router.push(`/round/${sportSlug}/${roundId}/results`)} style={{ marginTop: spacing.lg }} />
      )}

      {!hasDaySlots && <SectionLabel>Games</SectionLabel>}
    </View>
  );

  const renderGame = (item: api.RoundDetail["games"][number]) => (
    <GameCard
      homeTeamName={item.homeTeam.name}
      awayTeamName={item.awayTeam.name}
      homeScore={item.homeScore}
      awayScore={item.awayScore}
      kickoffLine={formatAuDateTime(item.kickoff)}
      status={item.status}
    />
  );

  return (
    <View style={styles.container}>
      {!detail && !error && <LoadingState label="Loading round…" />}
      {error && <ErrorState message={error} onRetry={load} />}
      {detail && hasDaySlots && (
        <SectionList
          sections={daySections}
          keyExtractor={(g) => String(g.id)}
          contentContainerStyle={styles.list}
          ListHeaderComponent={header}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <SectionLabel>{section.title}</SectionLabel>
              <Text style={styles.sectionCount}>
                {section.data.length} {section.data.length === 1 ? "game" : "games"}
              </Text>
            </View>
          )}
          renderItem={({ item }) => renderGame(item)}
        />
      )}
      {detail && !hasDaySlots && (
        <FlatList
          data={detail.games}
          keyExtractor={(g) => String(g.id)}
          contentContainerStyle={styles.list}
          ListHeaderComponent={header}
          ListEmptyComponent={<EmptyState title="No games scheduled yet" description="Fixtures for this round haven't been published yet." />}
          renderItem={({ item }) => renderGame(item)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  header: { paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: { ...typography.heading, fontSize: 22, color: colors.foreground },
  badgeRow: { marginTop: spacing.sm, flexDirection: "row" },
  summaryLine: { color: colors.muted, fontSize: 13, marginTop: spacing.sm },
  infoCard: { marginTop: spacing.md, gap: spacing.sm },
  sectionHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  sectionCount: { color: colors.muted, fontSize: 12, marginBottom: spacing.sm },
  stateNote: { color: colors.muted, fontSize: 13, marginTop: spacing.lg, textAlign: "center" },
});
