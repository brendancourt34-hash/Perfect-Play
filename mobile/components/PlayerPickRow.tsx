import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, minTouchTarget, radius, spacing, font } from "../constants/theme";

interface PlayerPickRowProps {
  label: string;
  player: { name: string; teamName: string; position: string } | null;
  accessibilityLabel: string;
  onPress: () => void;
}

/** One "Select player" slot inside a game's pick card on the Enter Picks screen. */
export function PlayerPickRow({ label, player, accessibilityLabel, onPress }: PlayerPickRowProps) {
  return (
    <Pressable style={[styles.row, player && styles.rowPicked]} accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}>
      <Text style={styles.label}>{label}</Text>
      {player ? (
        <View>
          <Text style={styles.name}>{player.name}</Text>
          <Text style={styles.meta}>
            {player.teamName} · {player.position}
          </Text>
        </View>
      ) : (
        <Text style={styles.placeholder}>Select player</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
  },
  rowPicked: { borderLeftWidth: 4, borderLeftColor: colors.brand },
  label: { color: colors.muted, fontSize: 11, fontFamily: font.w700, textTransform: "uppercase", marginBottom: 2 },
  placeholder: { color: colors.foreground, fontFamily: font.w600, fontSize: 15, minHeight: minTouchTarget - 24 },
  name: { color: colors.foreground, fontSize: 16, fontFamily: font.w700 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 1 },
});
