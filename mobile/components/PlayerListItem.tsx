import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, minTouchTarget, spacing } from "../constants/theme";
import { Icon } from "./icons";

/** Real provider-reported designations only (never "OUT" — those are already excluded server-side, never reach this component). Labels shown to the customer for each. */
const INJURY_BADGE_LABEL: Record<string, string> = {
  DAY_TO_DAY: "Day-To-Day",
  DOUBTFUL: "Doubtful",
  QUESTIONABLE: "Questionable",
  // PROBABLE deliberately has no badge — "expected to play" isn't worth flagging.
};

interface PlayerListItemProps {
  name: string;
  teamName: string;
  position: string;
  /** Real provider-reported injury designation, or null/undefined for none. Only DAY_TO_DAY/DOUBTFUL/QUESTIONABLE render a badge — see INJURY_BADGE_LABEL. Never "OUT" (excluded server-side before this player ever reaches the picker). */
  injuryStatus?: string | null;
  disabled?: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}

/** One row in the player picker sheet's searchable list. */
export function PlayerListItem({ name, teamName, position, injuryStatus, disabled, accessibilityLabel, onPress }: PlayerListItemProps) {
  const badgeLabel = injuryStatus ? INJURY_BADGE_LABEL[injuryStatus] : undefined;
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.row, disabled && styles.rowDisabled, pressed && !disabled && styles.rowPressed]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.name, disabled && styles.mutedText]}>{name}</Text>
        <Text style={styles.meta}>
          {teamName} · {position}
        </Text>
      </View>
      {badgeLabel && !disabled && (
        <View style={styles.injuryBadge}>
          <Text style={styles.injuryBadgeText}>{badgeLabel}</Text>
        </View>
      )}
      {disabled && (
        <View style={styles.disabledTag}>
          <Icon name="check" size={12} color={colors.muted2} />
          <Text style={styles.disabledText}>Other pick</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: minTouchTarget + 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.surfaceRaised },
  rowDisabled: { opacity: 0.4 },
  name: { color: colors.foreground, fontSize: 16, fontWeight: "600" },
  meta: { color: colors.muted, fontSize: 13, marginTop: 2 },
  mutedText: { color: colors.muted },
  disabledTag: { flexDirection: "row", alignItems: "center", gap: 4 },
  disabledText: { color: colors.muted2, fontSize: 12, fontWeight: "600" },
  // Neutral, no-color treatment — this app's design system deliberately has no
  // warning/danger hue (see constants/theme.ts) — informational only, never alarming.
  injuryBadge: {
    backgroundColor: colors.neutralSoft,
    borderWidth: 1,
    borderColor: colors.neutralBorder,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  injuryBadgeText: { color: colors.muted, fontSize: 10, fontWeight: "700", letterSpacing: 0.2 },
});
