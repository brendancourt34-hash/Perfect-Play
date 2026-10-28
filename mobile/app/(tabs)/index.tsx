import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import * as api from "../../lib/api";
import { SPORTS, type SportSlug } from "../../constants/sports";
import { SportEntryCard } from "../../components/SportEntryCard";
import { FeaturedCompetitionCard } from "../../components/FeaturedCompetitionCard";
import { RoundListItem } from "../../components/RoundListItem";
import { Card } from "../../components/Card";
import { IconButton } from "../../components/IconButton";
import { Icon } from "../../components/icons";
import { PPMark } from "../../components/PPMark";
import { Screen } from "../../components/Screen";
import { colors, spacing, typography } from "../../constants/theme";
import { formatAudCents, formatAuDate, formatAuDateTime } from "../../lib/format";

const SPORT_SLUGS = Object.keys(SPORTS) as SportSlug[];
/** How many rounds to show in "Upcoming Competitions", excluding whichever round is featured. */
const UPCOMING_LIMIT = 4;
/**
 * The image's aspect ratio, per RN/Metro's OWN resolution of the asset — not a hardcoded
 * literal. Image.resolveAssetSource() returns exactly what the layout engine itself will
 * use for this require()'d file's intrinsic size; if there were ever a mismatch between
 * "what I assume the file's dimensions are" (1145×1373, confirmed via direct file
 * inspection) and "what Metro/RN actually resolved for it," reading it from here instead
 * of hardcoding rules that out entirely as a source of error.
 */
const HERO_STRIP_SOURCE = require("../../assets/hero-strip.png");
const HERO_STRIP_RESOLVED = Image.resolveAssetSource(HERO_STRIP_SOURCE);
const HERO_STRIP_ASPECT_RATIO = HERO_STRIP_RESOLVED.width / HERO_STRIP_RESOLVED.height;

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
  // heroBackdrop (the confirmed-working image container) keeps rendering at its own full
  // natural height, unaffected by anything below — only the OUTER wrapper is shorter, by
  // ~10%, clipping the image's own empty/faded bottom margin from the page's layout
  // footprint. See the hero JSX comment for the full reasoning.
  const { width: heroWindowWidth } = useWindowDimensions();
  const heroNaturalHeight = heroWindowWidth / HERO_STRIP_ASPECT_RATIO;
  const heroVisibleHeight = heroNaturalHeight * 0.9;
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
        {/*
          CONFIRMED WORKING — do not touch: the ExpoImage element, its contentFit prop, and
          heroBackdrop's own width/aspectRatio are exactly what rendered the complete,
          uncropped four-athlete artwork correctly. Nothing about the image or its own
          container changes below.

          The ~10% vertical reduction is achieved WITHOUT touching any of that: heroBackdrop
          is absolutely positioned (top/left/right:0, no bottom) inside heroVisibleWrap, a
          new outer wrapper whose explicit height is 90% of the image's natural full-width
          height and which clips with overflow:"hidden". heroBackdrop keeps rendering at its
          own full natural height internally (same as before, same aspect ratio, same
          width) — only its bottom ~10% (confirmed via earlier pixel sampling to be empty/
          faded-to-black, containing none of the four athletes) is clipped from the visible
          page layout, so no athlete or image content is cut off and the image's own
          rendering logic is genuinely unmodified.

          Header and the headline sit as NORMAL (non-absolute) siblings of heroBackdrop
          inside heroVisibleWrap, so they lay out relative to the REDUCED 90% height, not
          the full underlying image height — this is what keeps the headline positioned
          over the visible lower portion of the artwork rather than sitting in the clipped-
          off region below it.
        */}
        <View style={[styles.heroVisibleWrap, { height: heroVisibleHeight }]}>
          <View style={[styles.heroBackdrop, { height: heroNaturalHeight }]}>
            <ExpoImage source={HERO_STRIP_SOURCE} style={StyleSheet.absoluteFill} contentFit="contain" />
            {/* Legibility gradient: near-transparent over the athletes at the top, darkening
                steeply toward the bottom where the headline sits, so the artwork stays
                visible up top without fighting the text lower down. */}
            <LinearGradient
              colors={["transparent", "rgba(0,0,0,0.05)", "rgba(0,0,0,0.55)", "rgba(0,0,0,0.9)"]}
              locations={[0, 0.45, 0.75, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <LinearGradient
              colors={["rgba(0,230,118,0.16)", "transparent"]}
              start={{ x: 1, y: 0 }}
              end={{ x: 0.3, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </View>

          <View style={styles.header}>
            <View style={styles.brandRow}>
              <PPMark size={24} />
              <Text style={styles.wordmark}>
                Perfect <Text style={styles.wordmarkAccent}>Play</Text>
              </Text>
            </View>
            <IconButton name="bell" accessibilityLabel="Notifications" variant="plain" onPress={() => router.push("/(tabs)/account")} />
          </View>

          <View style={styles.heroTextWrap}>
            <Text style={styles.tagline}>GO PERFECT.</Text>
            {/* Explicit hard breaks, not flow-wrap — the reference wraps this exact phrase as
                "TAKE THE" / "ENTIRE POOL.", not "TAKE THE ENTIRE" / "POOL.", and that break
                point must not depend on font size or container width. */}
            <Text style={[styles.tagline, styles.taglineAccent]}>
              TAKE THE{"\n"}ENTIRE POOL.
            </Text>
          </View>
        </View>

        {/* Supporting copy moved out of the artwork entirely — clear separation from the
            headline, fully readable on the plain page background. */}
        <View style={styles.explainer}>
          <Text style={styles.explainerBody}>No entries go perfect, pool rolls over to the following week.</Text>
          <Text style={styles.explainerBody}>More than one entry goes perfect, split the pool evenly.</Text>
        </View>

        {/* Featured Competition — placed directly under the hero copy, ahead of "Choose a
            Sport", per the approved reference. Hidden entirely (not a placeholder/empty
            state) when there's genuinely no eligible round anywhere, per the brief's own
            "gracefully hide" requirement for that state. */}
        {featured && (
          <View style={styles.featuredCardWrap}>
            <FeaturedCompetitionCard
              sport={SPORTS[featured.sportSlug]}
              // Always "Round N" from the real roundNumber — never the round's free-text
              // admin-entered name (e.g. "Perfect Play NBA — Round 1") — so the card's
              // title reads "{SPORT} — ROUND N", never "PERFECT PLAY {SPORT} — ROUND N".
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
                  // Matches the existing single-entry navigation used on the confirmation/
                  // buy-in screens ("View my entry" -> /entry/[entryId]).
                  router.push(`/entry/${featuredEntries[0].entryId}`);
                } else if (featuredEntries.length > 1) {
                  // Multiple entries in this round: no single canonical entry to jump to,
                  // so route to My Entries — same fallback used elsewhere in the app.
                  router.push("/(tabs)/my-entries");
                } else {
                  router.push(`/round/${featured.sportSlug}/${featured.round.id}/buy-in`);
                }
              }}
            />
          </View>
        )}

        <SectionHeader title="Choose a Sport" actionLabel="View All →" onActionPress={() => router.push("/(tabs)/competitions")} />
        <View style={styles.sportGrid}>
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

        <View style={styles.quickActions}>
          <QuickActionCard
            icon="trophy"
            title="How it Works"
            subtitle={"Simple. Pick. Play.\nGo Perfect."}
            onPress={() => router.push("/how-it-works")}
          />
          <QuickActionCard
            icon="wallet"
            title="My Wallet"
            subtitle={balanceCents === null ? "—" : formatAudCents(balanceCents)}
            onPress={() => router.push("/(tabs)/wallet")}
          />
        </View>

        {upcoming.length > 0 && (
          <>
            <SectionHeader title="Upcoming Competitions" actionLabel="View All →" onActionPress={() => router.push("/(tabs)/competitions")} />
            <View style={styles.upcomingList}>
              {upcoming.map(({ sportSlug, round }) => (
                <RoundListItem
                  key={`${sportSlug}-${round.id}`}
                  title={`${SPORTS[sportSlug].name} — ${round.name ?? `Round ${round.roundNumber}`}`}
                  state={round.competition?.state ?? null}
                  dateLine={dateLine(round)}
                  feeLine={feeLine(sportSlug, round)}
                  dateChip={round.startDate ? new Date(round.startDate) : undefined}
                  onPress={() => router.push(`/round/${sportSlug}/${round.id}`)}
                />
              ))}
            </View>
          </>
        )}

        <Text style={styles.footnote}>
          No points. No leaderboard. No fantasy scoring. Every pick is simply correct or incorrect — get every pick
          right to go PERFECT. More than one PERFECT entry? Split the pool evenly.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function SectionHeader({ title, actionLabel, onActionPress }: { title: string; actionLabel?: string; onActionPress?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {actionLabel && onActionPress && (
        <Pressable onPress={onActionPress} hitSlop={8}>
          <Text style={styles.sectionAction}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

function QuickActionCard({ icon, title, subtitle, onPress }: { icon: "trophy" | "wallet"; title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={styles.quickActionPressable}>
      <Card style={styles.quickActionCard}>
        <Icon name={icon} size={20} color={colors.brand} />
        <View style={styles.quickActionText}>
          <Text style={styles.quickActionTitle}>{title.toUpperCase()}</Text>
          <Text style={styles.quickActionSubtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        </View>
        <Icon name="chevronRight" size={16} color={colors.muted2} />
      </Card>
    </Pressable>
  );
}

/**
 * This screen's vertical rhythm is deliberately its OWN tightened scale, not the app-wide
 * spacing.* tokens used ad-hoc — measuring Perfect 2/rebrand.png end-to-end shows the whole
 * page (header through the second upcoming row) fills close to one full phone screen with
 * almost no dead space between sections (gaps of roughly 12-20pt, not 24pt+). Reusing
 * spacing.xl between every section was the main reason the page read as sparse/empty
 * compared to the reference — this scale replaces that, section by section.
 */
const GUTTER = 18; // reference's measured ~20pt left/right margin
// Computed, not guessed: on a 390×844pt iPhone (a common baseline — if it fits here it
// fits on larger devices too), available ScrollView content height after the Screen's top
// safe-area inset (~50pt) and the bottom tab bar's total footprint (~91pt, itself
// including its own bottom safe-area) is ~703pt. Summing every section's height with the
// PREVIOUS spacing values (with the hero at its confirmed-correct, untouched ~421pt) came
// to ~793-807pt depending on whether sport cards show real data or "No rounds yet" —
// roughly 90-105pt over budget. This trimmed value, together with the card-padding
// reductions below, is sized to close that specific, computed gap rather than an
// arbitrary guess.
const SECTION_GAP = 6;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 6 },
  // width:"100%" + aspectRatio (Yoga-native) — height is derived by the layout engine
  // itself from the container's real rendered width, so the box is always shaped exactly
  // like the source image: full width, full image, zero cropping, zero letterboxing.
  // Outer clipping wrapper — height is the ~10%-reduced value (set inline). relative +
  // hidden so heroBackdrop's own bottom margin (beyond this height) is clipped from the
  // page's layout footprint, without changing heroBackdrop's own sizing at all.
  heroVisibleWrap: { position: "relative", overflow: "hidden", width: "100%" },
  // Absolutely positioned within heroVisibleWrap (top/left/right:0, no bottom) so it
  // resolves its OWN full height from width+aspectRatio — completely independent of its
  // parent's shorter height. This, the ExpoImage inside it, and contentFit="contain" are
  // the confirmed-working image implementation; nothing here changed.
  heroBackdrop: { position: "absolute", top: 0, left: 0, right: 0, overflow: "hidden", aspectRatio: HERO_STRIP_ASPECT_RATIO },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: GUTTER, paddingTop: 6 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  wordmark: { fontSize: 17, fontWeight: "700", color: colors.foreground },
  wordmarkAccent: { color: colors.brand },
  // flex-end pins the headline to the bottom of the strip, over the artwork's own
  // fade-to-dark region rather than over the athletes' faces higher up.
  heroTextWrap: { flex: 1, justifyContent: "flex-end", paddingHorizontal: GUTTER, paddingBottom: 22 },
  tagline: {
    fontSize: 38,
    fontWeight: "800",
    letterSpacing: 0.1,
    lineHeight: 40,
    color: colors.foreground,
    textTransform: "uppercase",
  },
  taglineAccent: { color: colors.brand },
  // Substantially more separation from the headline than before (was marginTop: 10,
  // nested directly under it) — now its own section, clear of the artwork entirely.
  // Still substantially more separation from the headline than the original 10pt (an
  // explicit earlier requirement) — trimmed from 26 to help offset the taller hero.
  explainer: { marginTop: 6, paddingHorizontal: GUTTER, gap: 2 },
  explainerBody: { color: colors.muted2, fontSize: 12, lineHeight: 16 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: GUTTER, marginTop: SECTION_GAP, marginBottom: 4 },
  sectionTitle: { ...typography.overline, color: colors.foreground },
  sectionAction: { color: colors.brand, fontSize: 12, fontWeight: "800" },
  sportGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: GUTTER, gap: 6 },
  sportGridItem: { flexBasis: "22%", flexGrow: 1, minWidth: 78 },
  featuredCardWrap: { paddingHorizontal: GUTTER, marginTop: 8 },
  quickActions: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: GUTTER, marginTop: SECTION_GAP },
  quickActionPressable: { flex: 1 },
  quickActionCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: 9 },
  quickActionText: { flex: 1 },
  quickActionTitle: { color: colors.foreground, fontSize: 11, fontWeight: "800", letterSpacing: 0.3 },
  quickActionSubtitle: { color: colors.muted, fontSize: 10, marginTop: 2 },
  upcomingList: { paddingHorizontal: GUTTER, gap: spacing.sm },
  footnote: { color: colors.muted2, fontSize: 10, textAlign: "center", marginTop: SECTION_GAP, paddingHorizontal: GUTTER, lineHeight: 13 },
});
