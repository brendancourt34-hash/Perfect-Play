import { StyleSheet, Text, View } from "react-native";
import { Card } from "./Card";
import { Button } from "./Button";
import { CompetitionStateBadge, type CompetitionState } from "./StatusBadge";
import { colors, spacing, font } from "../constants/theme";
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
        <View style={styles.headerText}>
          <Text style={styles.title}>
            {sport.name} · {roundLabel}
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
                {sport.revealPhrase}
              </Text>
            </View>
          )}
        </View>
      </View>
      <Button label={`${ctaLabel} »`} onPress={onPress} style={styles.cta} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md, padding: 0, paddingTop: spacing.md, borderTopWidth: 4, borderTopColor: colors.brand, borderColor: colors.border },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingHorizontal: spacing.lg },
  headerText: { flex: 1, minWidth: 0 },
  title: { color: colors.foreground, fontFamily: font.display, fontSize: 24, textTransform: "uppercase" },
  subtitle: { color: colors.muted, fontSize: 13, fontFamily: font.w500, marginTop: 2 },
  footerRow: { paddingHorizontal: spacing.lg },
  prizeLabel: { color: colors.muted, fontSize: 11, fontFamily: font.w700, textTransform: "uppercase", letterSpacing: 1.4 },
  prizeValue: { fontSize: 26, fontFamily: font.display, color: colors.brandText, marginTop: 2 },
  revealPill: { marginTop: 2 },
  revealPillText: { color: colors.foreground, fontSize: 20, fontFamily: font.display, textTransform: "uppercase" },
  cta: { alignSelf: "stretch" },
});
