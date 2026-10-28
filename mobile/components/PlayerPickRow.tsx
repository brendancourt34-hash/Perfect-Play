import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, minTouchTarget, radius, spacing } from "../constants/theme";

interface PlayerPickRowProps {
  label: string;
  player: { name: string; teamName: string; position: string } | null;
  accessibilityLabel: string;
  onPress: () => void;
}

/** One "Select player" slot inside a game's pick card on the Enter Picks screen. */
export function PlayerPickRow({ label, player, accessibilityLabel, onPress }: PlayerPickRowProps) {
  return (
    <Pressable style={styles.row} accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}>
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
  label: { color: colors.muted2, fontSize: 11, fontWeight: "700", textTransform: "uppercase", marginBottom: 2 },
  placeholder: { color: colors.muted, fontSize: 15, minHeight: minTouchTarget - 24 },
  name: { color: colors.brand, fontSize: 15, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 12, marginTop: 1 },
});
