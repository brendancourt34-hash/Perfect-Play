import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as api from "../../lib/api";
import { SPORTS, type SportSlug } from "../../constants/sports";
import { SportEntryCard } from "../../components/SportEntryCard";
import { FeaturedCompetitionCard } from "../../components/FeaturedCompetitionCard";
import { RoundListItem } from "../../components/RoundListItem";
import { IconButton } from "../../components/IconButton";
import { PPMark } from "../../components/PPMark";
import { Screen } from "../../components/Screen";
import { colors, spacing, typography, font } from "../../constants/theme";
import { formatAudCents, formatAuDate, formatAuDateTime } from "../../lib/format";

const SPORT_SLUGS = Object.keys(SPORTS) as SportSlug[];
/** How many rounds to show in "Upcoming Competitions", excluding whichever round is featured. */
const UPCOMING_LIMIT = 4;
interface SportRoundsState {
  rounds: api.RoundSummary[];
  sportSlug: SportSlug;
}

/**
 * The round this sport's card should reflect: the earliest round that hasn't closed or
 * settled yet (open or not-yet-open), or — if every round has already played out — the
 * most recent one, so the card still shows something meaningful. The server remains
 * authoritative for the actual pool amount/visibility; this only decides WHICH round's
 * numbers to display.
 */
function pickFeaturedRound(rounds: api.RoundSummary[]): api.RoundSummary | null {
  if (rounds.length === 0) return null;
  // "Open-ish" also requires real games — a round with zero games (an incomplete/invalid
  // round, or one whose games haven't synced yet) is never a real customer-facing
  // competition, so it must never be presented as one, no matter what its competition
  // state is.
  const upcoming = rounds.find((r) => r.gamesCount > 0 && (!r.competition || r.competition.state === "open" || r.competition.state === "not_yet_open"));
  return upcoming ?? rounds[rounds.length - 1];
}

function cutoffTime(round: api.RoundSummary): number {
  const cutoff = round.competition?.buyInCutoffAt ?? round.competition?.closesAt ?? round.startDate;
  const parsed = cutoff ? new Date(cutoff).getTime() : NaN;
  return Number.isNaN(parsed) ? Infinity : parsed;
}

/**
 * Across every sport's own featured round (see pickFeaturedRound), the single soonest
 * open/not-yet-open cutoff — the next real, customer-enterable Perfect Play competition,
 * dynamically, from whichever sport it belongs to. No manual "featured" flag exists
 * anywhere in this app; this is purely derived from each round's real state/cutoff every
 * time Home loads. Deliberately does NOT fall back to a closed/settled round just to show
 * *something* — per product rule, a closed or settled competition is never featured; if
 * nothing across every sport is currently open/upcoming, the Featured Competition section
 * is hidden entirely (see the `{featured && (...)}` guard in HomeScreen) rather than
 * showing something the customer can no longer act on.
 */
function pickOverallFeatured(bySport: Partial<Record<SportSlug, api.RoundSummary | null>>): { sportSlug: SportSlug; round: api.RoundSummary } | null {
  let best: { sportSlug: SportSlug; round: api.RoundSummary } | null = null;
  for (const slug of SPORT_SLUGS) {
    const round = bySport[slug];
    if (!round) continue;
    if (round.gamesCount <= 0) continue;
    const isOpenish = !round.competition || round.competition.state === "open" || round.competition.state === "not_yet_open";
    if (!isOpenish) continue;
    if (!best || cutoffTime(round) < cutoffTime(best.round)) best = { sportSlug: slug, round };
  }
  return best;
}

export default function HomeScreen() {
  const router = useRouter();
  const [bySport, setBySport] = useState<Partial<Record<SportSlug, SportRoundsState>>>({});
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [myEntries, setMyEntries] = useState<api.MyEntry[]>([]);

  // Fires all three requests in parallel AND commits each one's state as soon as IT
  // resolves, rather than batching every commit behind a single Promise.all — the
  // Featured Competition / sport grid (driven only by roundResults) must never sit
  // waiting on wallet balance or My Entries just because they happened to be bundled
  // into the same await. Each branch already renders a sane placeholder for its own
  // still-loading state (see balanceCents === null below), so this is a pure win with
  // no new loading UI required.
  const load = useCallback(() => {
    Promise.all(SPORT_SLUGS.map((slug) => api.getRounds(slug))).then((roundResults) => {
      const next: Partial<Record<SportSlug, SportRoundsState>> = {};
      SPORT_SLUGS.forEach((slug, i) => {
        const result = roundResults[i];
        next[slug] = { sportSlug: slug, rounds: result.ok ? result.data.rounds : [] };
      });
      setBySport(next);
    });
    api.getWalletBalance().then((balanceResult) => {
      if (balanceResult.ok) setBalanceCents(balanceResult.data.balanceCents);
    });
    api.listMyEntries().then((entriesResult) => {
      if (entriesResult.ok) setMyEntries(entriesResult.data.entries);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const featuredBySport = useMemo(() => {
    const out: Partial<Record<SportSlug, api.RoundSummary | null>> = {};
    for (const slug of SPORT_SLUGS) out[slug] = bySport[slug] ? pickFeaturedRound(bySport[slug]!.rounds) : null;
    return out;
  }, [bySport]);

  const featured = useMemo(() => pickOverallFeatured(featuredBySport), [featuredBySport]);

  // Matches Competitions tab's own entered-round filter (sportCode + roundId) — reused
  // rather than reinvented, per the brief's explicit "use the same approach" instruction.
  const featuredEntries = useMemo(() => {
    if (!featured) return [];
    return myEntries.filter((e) => e.sportCode === featured.sportSlug && e.roundId === featured.round.id);
  }, [myEntries, featured]);

  const upcoming = useMemo(() => {
    const all: { sportSlug: SportSlug; round: api.RoundSummary }[] = [];
    for (const slug of SPORT_SLUGS) {
      const rounds = bySport[slug]?.rounds ?? [];
      for (const round of rounds) {
        if (featured && slug === featured.sportSlug && round.id === featured.round.id) continue;
        const isOpenish = !round.competition || round.competition.state === "open" || round.competition.state === "not_yet_open";
        if (isOpenish) all.push({ sportSlug: slug, round });
      }
    }
    all.sort((a, b) => cutoffTime(a.round) - cutoffTime(b.round));
    return all.slice(0, UPCOMING_LIMIT);
  }, [bySport, featured]);

  function dateLine(round: api.RoundSummary): string {
    const c = round.competition;
    if (c?.state === "open" && c.closesAt) return `Closes ${formatAuDateTime(c.closesAt)}`;
    if (c?.state === "not_yet_open" && c.opensAt) return `Opens ${formatAuDateTime(c.opensAt)}`;
    return round.startDate ? formatAuDate(round.startDate) : "Date TBC";
  }

  function feeLine(sportSlug: SportSlug, round: api.RoundSummary): string {
    const c = round.competition;
    const prizeLine =
      c?.prizePoolVisible && c.currentPrizePoolCents !== null ? `${formatAudCents(c.currentPrizePoolCents)} Prize` : SPORTS[sportSlug].revealPhrase.toUpperCase();
    return `${round.gamesCount} game${round.gamesCount === 1 ? "" : "s"} · ${prizeLine}`;
  }

  return (
    <Screen>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <PPMark size={30} />
            <Text style={styles.wordmark}>Perfect Play</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={balanceCents === null ? "Wallet" : `Wallet balance ${formatAudCents(balanceCents)}`}
              onPress={() => router.push("/(tabs)/wallet")}
              style={styles.balanceChip}
            >
              <Text style={styles.balanceText}>{balanceCents === null ? "—" : formatAudCents(balanceCents)}</Text>
            </Pressable>
            <IconButton name="bell" accessibilityLabel="Notifications and account" variant="filled" onPress={() => router.push("/(tabs)/account")} />
          </View>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroLine}>Go perfect.</Text>
          <Text style={[styles.heroLine, styles.heroAccent]}>Take the entire pool.</Text>
        </View>

        {featured && (
          <View style={styles.section}>
            <FeaturedCompetitionCard
              sport={SPORTS[featured.sportSlug]}
              // Always "Round N" from the real roundNumber — never the round's free-text
              // admin-entered name, so internal/QA names can never reach customers.
              roundLabel={`Round ${featured.round.roundNumber}`}
              gamesCount={featured.round.gamesCount}
              state={featured.round.competition?.state ?? null}
              entryFeeCents={featured.round.competition?.entryFeeCents}
              prizePoolVisible={featured.round.competition?.prizePoolVisible ?? false}
              currentPrizePoolCents={featured.round.competition?.currentPrizePoolCents ?? null}
              buyInCutoffAt={featured.round.competition?.buyInCutoffAt ? new Date(featured.round.competition.buyInCutoffAt) : null}
              alreadyEntered={featuredEntries.length > 0}
              onCardPress={() => router.push(`/round/${featured.sportSlug}/${featured.round.id}`)}
              onEnterPress={() => {
                const state = featured.round.competition?.state;
                if (state === "settled") {
                  router.push(`/round/${featured.sportSlug}/${featured.round.id}/results`);
                } else if (featuredEntries.length === 1) {
                  router.push(`/entry/${featuredEntries[0].entryId}`);
                } else if (featuredEntries.length > 1) {
                  router.push("/(tabs)/my-entries");
                } else {
                  router.push(`/round/${featured.sportSlug}/${featured.round.id}/buy-in`);
                }
              }}
            />
          </View>
        )}

        <View style={[styles.section, styles.sportGrid]}>
          {SPORT_SLUGS.map((slug) => {
            const featuredRound = featuredBySport[slug];
            return (
              <View key={slug} style={styles.sportGridItem}>
                <SportEntryCard
                  sport={SPORTS[slug]}
                  roundNumber={featuredRound ? featuredRound.roundNumber : null}
                  onPress={() => router.push(`/(tabs)/${slug}`)}
                />
              </View>
            );
          })}
        </View>

        <View style={[styles.section, styles.rules]}>
          <Text style={styles.ruleText}>No PERFECT entry? The pool rolls over.</Text>
          <Text style={styles.ruleText}>More than one? It's split evenly per entry.</Text>
          <Pressable accessibilityRole="link" onPress={() => router.push("/how-it-works")} hitSlop={8}>
            <Text style={styles.ruleLink}>How it works »</Text>
          </Pressable>
        </View>

        {upcoming.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Up next</Text>
            <View style={styles.upcomingList}>
              {upcoming.map(({ sportSlug, round }) => (
                <RoundListItem
                  key={`${sportSlug}-${round.id}`}
                  title={`${SPORTS[sportSlug].name} · Round ${round.roundNumber}`}
                  state={round.competition?.state ?? null}
                  dateLine={dateLine(round)}
                  feeLine={feeLine(sportSlug, round)}
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

const GUTTER = 20;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: spacing.xl },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: GUTTER, paddingTop: spacing.sm },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  wordmark: { fontSize: 22, fontFamily: font.display, color: colors.foreground, textTransform: "uppercase", letterSpacing: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  balanceChip: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  balanceText: { color: colors.foreground, fontFamily: font.displayBold, fontSize: 17 },
  hero: { paddingHorizontal: GUTTER, paddingTop: spacing.lg },
  heroLine: { color: colors.foreground, fontFamily: font.display, fontSize: 52, lineHeight: 50, textTransform: "uppercase" },
  heroAccent: { color: colors.brandText, fontSize: 32, lineHeight: 34 },
  section: { paddingHorizontal: GUTTER, marginTop: spacing.lg },
  sportGrid: { flexDirection: "row", gap: 6 },
  sportGridItem: { flex: 1 },
  rules: { gap: 2 },
  ruleText: { color: colors.muted, fontFamily: font.w500, fontSize: 13 },
  ruleLink: { color: colors.brandText, fontFamily: font.w700, fontSize: 13, marginTop: spacing.xs },
  sectionTitle: { color: colors.foreground, fontFamily: font.display, fontSize: 20, textTransform: "uppercase", marginBottom: spacing.sm },
  upcomingList: { gap: 6 },
});
