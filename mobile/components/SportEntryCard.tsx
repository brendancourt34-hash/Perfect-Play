import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card } from "./Card";
import { colors, radius, spacing } from "../constants/theme";
import type { SPORTS } from "../constants/sports";

interface SportEntryCardProps {
  sport: (typeof SPORTS)[keyof typeof SPORTS];
  /** The current/next available Perfect Play round number for this sport, or null when the sport genuinely has no round yet — never a schedule-pool/test round, never fabricated. */
  roundNumber: number | null;
  onPress: () => void;
}

/**
 * The compact, identical-dimensions per-sport navigation card shown 4-across on the Home
 * screen (NRL/AFL/NBA/NFL) — deliberately minimal (badge, sport name, round number only)
 * so all four cards are always the exact same size regardless of which sport currently
 * has richer data available. Game counts, prize amounts, and competition titles belong on
 * the round detail / Featured Competition card, never here — this is pure sport
 * navigation, not a data-dense summary.
 */
export function SportEntryCard({ sport, roundNumber, onPress }: SportEntryCardProps) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={sport.fullName} onPress={onPress}>
      <Card style={styles.card}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{sport.code.toUpperCase()}</Text>
        </View>
        <Text style={styles.title}>{sport.name}</Text>
        <Text style={styles.roundLine} numberOfLines={1}>
          {roundNumber !== null ? `ROUND ${roundNumber}` : "NO ROUND"}
        </Text>
      </Card>
    </Pressable>
  );
}

/**
 * Fixed height (not just fixed padding) — the whole point of this rewrite is that a
 * sport with richer round data must never grow taller than one with none, so `height` is
 * set explicitly rather than left to intrinsic content sizing.
 */
const CARD_HEIGHT = 92;

const styles = StyleSheet.create({
  card: {
    height: CARD_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    gap: 4,
    borderRadius: radius.sm,
    borderColor: "rgba(255,255,255,0.08)",
  },
  badge: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.brandBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: colors.brand, fontWeight: "800", fontSize: 11 },
  title: { color: colors.foreground, fontWeight: "800", fontSize: 12 },
  roundLine: { color: colors.muted, fontWeight: "700", fontSize: 10, letterSpacing: 0.3 },
});
