import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "../constants/theme";

interface ProgressBarProps {
  label: string;
  complete: number;
  total: number;
}

/** Pick-progress indicator on the "make your picks" screen — e.g. "3 / 5 games complete". */
export function ProgressBar({ label, complete, total }: ProgressBarProps) {
  const pct = total > 0 ? Math.min(100, Math.round((complete / total) * 100)) : 0;
  return (
    <View style={styles.container}>
      <Text style={styles.text}>{label}</Text>
      <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: complete }}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  text: { color: colors.muted, fontSize: 13, fontWeight: "600", marginBottom: spacing.xs },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: colors.brand, borderRadius: radius.pill },
});
