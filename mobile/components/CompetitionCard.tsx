import { StyleSheet, Text, View } from "react-native";
import { Card } from "./Card";
import { Button } from "./Button";
import { CompetitionStateBadge, type CompetitionState } from "./StatusBadge";
import { colors, radius, spacing, typography } from "../constants/theme";
import { formatAudCents } from "../lib/format";
import type { SPORTS } from "../constants/sports";

interface CompetitionCardProps {
  sport: (typeof SPORTS)[keyof typeof SPORTS];
  roundLabel: string;
  gamesCount: number;
  state: CompetitionState | null;
  /** null when there's no known cutoff/open/close time to show. */
  timingLabel?: string | null;
  prizePoolVisible: boolean;
  currentPrizePoolCents: number | null;
  alreadyEntered?: boolean;
  onPress: () => void;
}

/**
 * The large, premium competition card used for the Competitions tab's "current
 * competition" spot — sport identity, round, games, status, prize-or-reveal, and a real
 * CTA, all in one dense but uncluttered card. Distinct from the leaner Home-screen
 * RoundListItem row, matching the reference's split between a lean Home list and a
 * substantial competition-browsing card.
 */
export function CompetitionCard({
  sport,
  roundLabel,
  gamesCount,
  state,
  timingLabel,
  prizePoolVisible,
  currentPrizePoolCents,
  alreadyEntered,
  onPress,
}: CompetitionCardProps) {
  const ctaLabel = state === "settled" ? "View Results" : alreadyEntered ? "View My Picks" : "Make Your Picks";

  return (
    <Card style={styles.card} highlighted>
      <View style={styles.headerRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{sport.code.toUpperCase()}</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>
            {sport.name} — {roundLabel}
          </Text>
          <Text style={styles.subtitle}>
            {gamesCount} {gamesCount === 1 ? "game" : "games"}
            {timingLabel ? ` · ${timingLabel}` : ""}
          </Text>
        </View>
        {state && <CompetitionStateBadge state={state} />}
      </View>

      <View style={styles.footerRow}>
        <View>
          <Text style={styles.prizeLabel}>Prize Pool</Text>
          {prizePoolVisible && currentPrizePoolCents !== null ? (
            <Text style={styles.prizeValue}>{formatAudCents(currentPrizePoolCents)}</Text>
          ) : (
            <View style={styles.revealPill}>
              <Text style={styles.revealPillText} numberOfLines={2}>
                {sport.revealPhrase.toUpperCase()}
              </Text>
            </View>
          )}
        </View>
        <Button label={ctaLabel} onPress={onPress} style={styles.cta} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md, padding: spacing.md },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
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
  headerText: { flex: 1, minWidth: 0 },
  title: { ...typography.subheading, color: colors.foreground },
  subtitle: { color: colors.muted, fontSize: 12, marginTop: 2 },
  footerRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: spacing.md },
  prizeLabel: { color: colors.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  prizeValue: { fontSize: 24, fontWeight: "800", color: colors.brand, marginTop: 2 },
  revealPill: {
    marginTop: 4,
    alignSelf: "flex-start",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  revealPillText: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
  cta: { paddingHorizontal: spacing.lg },
});
