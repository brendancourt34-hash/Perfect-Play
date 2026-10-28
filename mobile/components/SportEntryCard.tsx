import { Pressable, StyleSheet, Text } from "react-native";
import { colors, font } from "../constants/theme";
import type { SPORTS } from "../constants/sports";

interface SportEntryCardProps {
  sport: (typeof SPORTS)[keyof typeof SPORTS];
  /** The current/next available Perfect Play round number for this sport, or null when the sport genuinely has no round yet — never a schedule-pool/test round, never fabricated. */
  roundNumber: number | null;
  onPress: () => void;
}

/**
 * Option D sport tile, shown 4-across on Home. Fixed height so every tile is identical.
 * A sport with a live round gets the red border and a red "Round N" line; a sport with no
 * round reads "No round yet" in grey rather than the old bare "NO ROUND".
 */
export function SportEntryCard({ sport, roundNumber, onPress }: SportEntryCardProps) {
  const live = roundNumber !== null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${sport.fullName}${live ? `, round ${roundNumber}` : ", no round yet"}`}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, live && styles.tileLive, pressed && styles.pressed]}
    >
      <Text style={[styles.code, !live && styles.codeIdle]}>{sport.name}</Text>
      <Text style={[styles.line, live && styles.lineLive]} numberOfLines={1}>
        {live ? `ROUND ${roundNumber}` : "NO ROUND YET"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    height: 56,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  tileLive: { borderColor: colors.brand },
  pressed: { opacity: 0.75 },
  code: { color: colors.foreground, fontFamily: font.display, fontSize: 20, lineHeight: 22 },
  codeIdle: { color: colors.muted },
  line: { color: colors.muted, fontFamily: font.w600, fontSize: 9, letterSpacing: 0.4 },
  lineLive: { color: colors.brandText },
});
