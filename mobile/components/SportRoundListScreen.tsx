import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as api from "../lib/api";
import { SPORTS, type SportSlug } from "../constants/sports";
import { RoundListItem } from "./RoundListItem";
import { EmptyState, ErrorState, LoadingState } from "./ScreenStates";
import { Screen } from "./Screen";
import { colors, spacing, typography } from "../constants/theme";
import { formatAuDate, formatAuDateTime, formatAudCents } from "../lib/format";

/**
 * Shared by app/(tabs)/{nrl,afl,nba,nfl}.tsx — same UI, but each instance only ever calls
 * the API for its own sport slug. Sports' data is never merged: this component fetches and
 * renders exactly one sport's rounds per mount.
 */
/** `withTopInset` is false when embedded below another screen-level safe-area container (e.g. the Competitions tab's sport switcher) so the top inset isn't applied twice. */
export function SportRoundListScreen({ sportSlug, withTopInset = true }: { sportSlug: SportSlug; withTopInset?: boolean }) {
  const sport = SPORTS[sportSlug];
  const router = useRouter();
  const [rounds, setRounds] = useState<api.RoundSummary[] | null>(null);
  const [enteredRoundIds, setEnteredRoundIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [roundsResult, entriesResult] = await Promise.all([api.getRounds(sportSlug), api.listMyEntries()]);
    if (roundsResult.ok) {
      setRounds(roundsResult.data.rounds);
      setError(null);
    } else {
      setError(roundsResult.message);
    }
    if (entriesResult.ok) {
      setEnteredRoundIds(
        new Set(entriesResult.data.entries.filter((e) => e.sportCode === sportSlug).map((e) => e.roundId)),
      );
    }
  }, [sportSlug]);

  useEffect(() => {
    load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function dateLine(round: api.RoundSummary): string {
    const c = round.competition;
    if (c?.state === "open" && c.closesAt) return `Closes ${formatAuDateTime(c.closesAt)}`;
    if (c?.state === "not_yet_open" && c.opensAt) return `Opens ${formatAuDateTime(c.opensAt)}`;
    if (c?.state === "closed") return "Entries closed";
    if (c?.state === "settled") return "Settled";
    return round.startDate ? formatAuDate(round.startDate) : "Date TBC";
  }

  function feeLine(round: api.RoundSummary): string | null {
    const c = round.competition;
    if (!c) return null;
    const prizeLine = c.prizePoolVisible && c.currentPrizePoolCents !== null ? `${formatAudCents(c.currentPrizePoolCents)} Prize` : `Prize ${sport.revealPhrase}`;
    return `${formatAudCents(c.entryFeeCents)} Entry · ${prizeLine}`;
  }

  return (
    <Screen style={styles.container} edges={withTopInset ? ["top"] : []}>
      <View style={styles.header}>
        <Text style={styles.title}>{sport.fullName}</Text>
        <Text style={styles.subtitle}>{sport.pickLabel.replace(/\.$/, "")} · $5 entry</Text>
      </View>

      {!rounds && !error && <LoadingState label={`Loading ${sport.name} rounds…`} />}
      {error && <ErrorState message={error} onRetry={load} />}
      {rounds && rounds.length === 0 && (
        <EmptyState title="No rounds available" description={`${sport.name} fixtures haven't been published yet.`} />
      )}
      {rounds && rounds.length > 0 && (
        <FlatList
          data={rounds}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
          renderItem={({ item }) => (
            <RoundListItem
              title={item.name ?? `Round ${item.roundNumber}`}
              state={item.competition?.state ?? null}
              dateLine={dateLine(item)}
              feeLine={feeLine(item)}
              alreadyEntered={enteredRoundIds.has(item.id)}
              onPress={() => router.push(`/round/${sportSlug}/${item.id}`)}
            />
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.lg },
  title: { ...typography.title, color: colors.foreground },
  subtitle: { color: colors.muted, marginTop: spacing.xs, fontSize: 14 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
});
