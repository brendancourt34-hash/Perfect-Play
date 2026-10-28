import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as api from "../../lib/api";
import { SPORTS, type SportSlug } from "../../constants/sports";
import { CompetitionCard } from "../../components/CompetitionCard";
import { RoundListItem } from "../../components/RoundListItem";
import { DateChip } from "../../components/DateChip";
import { EmptyState, ErrorState } from "../../components/ScreenStates";
import { IconButton } from "../../components/IconButton";
import { PPMark } from "../../components/PPMark";
import { Screen } from "../../components/Screen";
import { colors, spacing, typography } from "../../constants/theme";
import { formatAuDate, formatAuDateTime, formatAudCents } from "../../lib/format";

const SPORT_SLUGS = Object.keys(SPORTS) as SportSlug[];
const GUTTER = 18;

function isOpenish(round: api.RoundSummary): boolean {
  return !round.competition || round.competition.state === "open" || round.competition.state === "not_yet_open";
}

/** The round this sport's "current competition" card should reflect — same rule as Home's pickFeaturedRound. */
function pickCurrentRound(rounds: api.RoundSummary[]): api.RoundSummary | null {
  if (rounds.length === 0) return null;
  return rounds.find(isOpenish) ?? rounds[rounds.length - 1];
}

/**
 * The Competitions tab — a focused competition-discovery screen: compact sport selector,
 * one prominent "current competition" card, then a lean upcoming list. Rebuilt (not
 * reusing SportRoundListScreen's per-sport full-page layout, which gave this tab an
 * oversized title block and a full-flex loading spinner that dominated the screen) to
 * match the Home screen's density and visual language.
 */
export default function CompetitionsScreen() {
  const router = useRouter();
  const [sportSlug, setSportSlug] = useState<SportSlug>(SPORT_SLUGS[0]);
  const [rounds, setRounds] = useState<api.RoundSummary[] | null>(null);
  const [enteredRoundIds, setEnteredRoundIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [roundsResult, entriesResult] = await Promise.all([api.getRounds(sportSlug), api.listMyEntries()]);
    if (roundsResult.ok) setRounds(roundsResult.data.rounds);
    else setError(roundsResult.message);
    if (entriesResult.ok) {
      setEnteredRoundIds(new Set(entriesResult.data.entries.filter((e) => e.sportCode === sportSlug).map((e) => e.roundId)));
    }
  }, [sportSlug]);

  useEffect(() => {
    setRounds(null);
    load();
  }, [load]);

  const sport = SPORTS[sportSlug];
  const current = rounds ? pickCurrentRound(rounds) : null;
  const upcoming = (rounds ?? []).filter((r) => r.id !== current?.id);

  function timingLabel(round: api.RoundSummary): string | null {
    const c = round.competition;
    if (c?.state === "open" && c.closesAt) return `Closes ${formatAuDateTime(c.closesAt)}`;
    if (c?.state === "not_yet_open" && c.opensAt) return `Opens ${formatAuDateTime(c.opensAt)}`;
    if (c?.state === "closed") return "Entries closed";
    if (c?.state === "settled") return "Settled";
    return null;
  }

  function dateLine(round: api.RoundSummary): string {
    return timingLabel(round) ?? (round.startDate ? formatAuDate(round.startDate) : "Date TBC");
  }

  function feeLine(round: api.RoundSummary): string | null {
    const c = round.competition;
    if (!c) return null;
    const prizeLine = c.prizePoolVisible && c.currentPrizePoolCents !== null ? `${formatAudCents(c.currentPrizePoolCents)} Prize` : `Prize ${sport.revealPhrase}`;
    return `${formatAudCents(c.entryFeeCents)} Entry · ${prizeLine}`;
  }

  return (
    <Screen style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <PPMark size={24} />
            <Text style={styles.wordmark}>
              Perfect <Text style={styles.wordmarkAccent}>Play</Text>
            </Text>
          </View>
          <IconButton name="bell" accessibilityLabel="Notifications" variant="plain" onPress={() => router.push("/(tabs)/account")} />
        </View>

        <View style={styles.titleBlock}>
          <Text style={styles.pageTitle}>Competitions</Text>
          <Text style={styles.pageSubtitle}>Choose your sport. Pick your players. Go Perfect.</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.selector}>
          {SPORT_SLUGS.map((slug) => {
            const active = slug === sportSlug;
            return (
              <Pressable
                key={slug}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setSportSlug(slug)}
                style={[styles.pill, active && styles.pillActive]}
              >
                <Text style={[styles.pillText, active && styles.pillTextActive]}>{SPORTS[slug].name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Text style={styles.sportMeta}>
          {sport.fullName.toUpperCase()} · {sport.pickLabel}
        </Text>

        {error && (
          <View style={styles.sectionGap}>
            <ErrorState message={error} onRetry={load} />
          </View>
        )}

        {!error && rounds === null && (
          <View style={styles.inlineLoading}>
            <ActivityIndicator color={colors.brand} />
            <Text style={styles.inlineLoadingText}>Loading {sport.name} rounds…</Text>
          </View>
        )}

        {!error && rounds !== null && rounds.length === 0 && (
          <View style={styles.sectionGap}>
            <EmptyState title="No rounds available" description={`${sport.name} fixtures haven't been published yet.`} />
          </View>
        )}

        {current && (
          <View style={styles.sectionGap}>
            <Text style={styles.sectionLabel}>Current Competition</Text>
            <CompetitionCard
              sport={sport}
              roundLabel={current.name ?? `Round ${current.roundNumber}`}
              gamesCount={current.gamesCount}
              state={current.competition?.state ?? null}
              timingLabel={timingLabel(current)}
              prizePoolVisible={current.competition?.prizePoolVisible ?? false}
              currentPrizePoolCents={current.competition?.currentPrizePoolCents ?? null}
              alreadyEntered={enteredRoundIds.has(current.id)}
              onPress={() => router.push(`/round/${sportSlug}/${current.id}`)}
            />
          </View>
        )}

        {upcoming.length > 0 && (
          <View style={styles.sectionGap}>
            <Text style={styles.sectionLabel}>Upcoming Competitions</Text>
            <View style={styles.upcomingList}>
              {upcoming.map((round) => (
                <RoundListItem
                  key={round.id}
                  title={round.name ?? `Round ${round.roundNumber}`}
                  state={round.competition?.state ?? null}
                  dateLine={dateLine(round)}
                  feeLine={feeLine(round)}
                  alreadyEntered={enteredRoundIds.has(round.id)}
                  dateChip={round.startDate ? new Date(round.startDate) : undefined}
                  onPress={() => router.push(`/round/${sportSlug}/${round.id}`)}
                />
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: spacing.xl },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: GUTTER, paddingTop: 6 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  wordmark: { fontSize: 17, fontWeight: "700", color: colors.foreground },
  wordmarkAccent: { color: colors.brand },
  titleBlock: { paddingHorizontal: GUTTER, marginTop: 18 },
  pageTitle: { fontSize: 28, fontWeight: "800", color: colors.foreground, textTransform: "uppercase", letterSpacing: 0.2 },
  pageSubtitle: { color: colors.muted, fontSize: 13, marginTop: 4 },
  selector: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: GUTTER, paddingTop: 16 },
  pill: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  pillActive: { backgroundColor: colors.brandSoft, borderColor: colors.brandBorder },
  pillText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  pillTextActive: { color: colors.brand },
  sportMeta: { color: colors.muted2, fontSize: 11, fontWeight: "700", letterSpacing: 0.3, paddingHorizontal: GUTTER, marginTop: 10 },
  sectionGap: { marginTop: 18, paddingHorizontal: GUTTER },
  sectionLabel: { ...typography.overline, color: colors.foreground, marginBottom: 10 },
  upcomingList: { gap: spacing.sm },
  inlineLoading: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: GUTTER, marginTop: 24 },
  inlineLoadingText: { color: colors.muted, fontSize: 13 },
});
