import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card } from "./Card";
import { Button } from "./Button";
import { Countdown } from "./Countdown";
import { Icon } from "./icons";
import { colors, radius, spacing, typography } from "../constants/theme";
import { formatAudCents } from "../lib/format";
import type { SPORTS } from "../constants/sports";
import type { CompetitionState } from "./StatusBadge";

interface FeaturedCompetitionCardProps {
  sport: (typeof SPORTS)[keyof typeof SPORTS];
  roundLabel: string;
  gamesCount: number;
  /** null when no competition row exists yet for this round. */
  state: CompetitionState | null;
  /** null/undefined when the entry fee isn't known yet — the "Entries From" line is simply omitted rather than guessed. */
  entryFeeCents?: number | null;
  prizePoolVisible: boolean;
  currentPrizePoolCents: number | null;
  /** Null when there's no known cutoff yet to count down to (e.g. fixtures not finalised). */
  buyInCutoffAt: Date | null;
  /** True when the authenticated user already has an entry in this round — only changes the CTA label for the open/not-yet-open state; closed/settled labels are untouched. */
  alreadyEntered?: boolean;
  /** The CTA button — routes to the real buy-in/entry flow, the user's existing entry/My Entries, or results, depending on state and alreadyEntered. */
  onEnterPress: () => void;
  /** Tapping the card body outside the CTA — routes to the round's own details page, matching the existing app's card/details navigation pattern. */
  onCardPress: () => void;
}

/**
 * The single most-imminent cross-sport competition, surfaced prominently on Home —
 * matches the approved reference layout: FEATURED badge, sport identity + round/games/
 * countdown in the middle, prize-pool-or-reveal + entry fee + CTA on the right.
 */
export function FeaturedCompetitionCard({
  sport,
  roundLabel,
  gamesCount,
  state,
  entryFeeCents,
  prizePoolVisible,
  currentPrizePoolCents,
  buyInCutoffAt,
  alreadyEntered = false,
  onEnterPress,
  onCardPress,
}: FeaturedCompetitionCardProps) {
  const isClosed = state === "closed";
  const isSettled = state === "settled";
  const ctaLabel = isSettled ? "View Results →" : isClosed ? "Enter Now →" : alreadyEntered ? "View My Entry →" : "Enter Now →";
  const ctaDisabled = isClosed;

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${sport.fullName} ${roundLabel} details`} onPress={onCardPress}>
    <Card style={styles.card} highlighted>
      <View style={styles.featuredBadge}>
        <Text style={styles.featuredBadgeText}>FEATURED</Text>
      </View>

      <View style={styles.mainRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{sport.code.toUpperCase()}</Text>
        </View>

        <View style={styles.midCol}>
          <Text style={styles.sportName}>{sport.name}</Text>
          {/* "{SPORT} — ROUND N" — never "Perfect Play {SPORT} — Round N": the small
              sport label above already establishes the brand/sport, so the large title
              only needs the sport code + round number, always derived from the round's
              real roundNumber (never its free-text name, and never hardcoded). */}
          <Text style={styles.roundLabel}>
            {sport.name} — {roundLabel.toUpperCase()}
          </Text>
          <View style={styles.metaRow}>
            <Icon name="flag" size={12} color={colors.muted} />
            <Text style={styles.metaText}>
              {gamesCount} {gamesCount === 1 ? "GAME" : "GAMES"}
            </Text>
          </View>
          {isClosed ? (
            <View style={styles.metaRow}>
              <Icon name="calendar" size={12} color={colors.muted} />
              <Text style={styles.metaText}>ENTRIES CLOSED</Text>
            </View>
          ) : isSettled ? (
            <View style={styles.metaRow}>
              <Icon name="calendar" size={12} color={colors.muted} />
              <Text style={styles.metaText}>SETTLED</Text>
            </View>
          ) : buyInCutoffAt ? (
            <View style={styles.countdownWrap}>
              <Countdown target={buyInCutoffAt} variant="compact" compactLabel="Starts In" />
            </View>
          ) : null}
        </View>

        <View style={styles.rightCol}>
          <View style={styles.prizeBox}>
            <View style={styles.prizeBoxHeader}>
              <Icon name="trophy" size={12} color={colors.muted} />
              <Text style={styles.prizeBoxLabel}>PRIZE POOL</Text>
            </View>
            {prizePoolVisible && currentPrizePoolCents !== null ? (
              <Text style={styles.prizeValue}>{formatAudCents(currentPrizePoolCents)}</Text>
            ) : (
              <Text style={styles.revealText}>{sport.revealPhrase.toUpperCase()}</Text>
            )}
          </View>
          {typeof entryFeeCents === "number" && (
            <View style={styles.entryFeeWrap}>
              <Text style={styles.entryFeeLabel}>ENTRIES FROM</Text>
              <Text style={styles.entryFeeValue}>{formatAudCents(entryFeeCents)}</Text>
            </View>
          )}
          <Button
            label={ctaLabel}
            onPress={onEnterPress}
            disabled={ctaDisabled}
            accessibilityLabel={ctaDisabled ? "Entries closed" : ctaLabel}
            style={styles.cta}
          />
        </View>
      </View>
    </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md, padding: spacing.md },
  featuredBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  featuredBadgeText: { color: colors.onBrand, fontSize: 9, fontWeight: "800", letterSpacing: 0.4 },
  mainRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  badge: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.brandBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: colors.brand, fontWeight: "800", fontSize: 11 },
  midCol: { flex: 1.1, minWidth: 0, gap: 3 },
  sportName: { color: colors.muted, fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },
  roundLabel: { ...typography.heading, color: colors.foreground, fontSize: 17 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { color: colors.muted, fontSize: 10, fontWeight: "700", letterSpacing: 0.2 },
  countdownWrap: { marginTop: 2 },
  rightCol: { flex: 1, minWidth: 0, gap: spacing.sm },
  prizeBox: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  prizeBoxHeader: { flexDirection: "row", alignItems: "center", gap: 4 },
  prizeBoxLabel: { color: colors.muted, fontSize: 9, fontWeight: "700", letterSpacing: 0.3 },
  prizeValue: { fontSize: 16, fontWeight: "800", color: colors.brand, marginTop: 3 },
  revealText: { fontSize: 11, fontWeight: "800", color: colors.brand, marginTop: 3, letterSpacing: 0.2 },
  entryFeeWrap: { gap: 1 },
  entryFeeLabel: { color: colors.muted, fontSize: 9, fontWeight: "700", letterSpacing: 0.3 },
  entryFeeValue: { color: colors.foreground, fontSize: 13, fontWeight: "800" },
  cta: { paddingHorizontal: spacing.md },
});
