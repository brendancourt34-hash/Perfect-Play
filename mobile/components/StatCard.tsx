import { StyleSheet, Text } from "react-native";
import { Card } from "./Card";
import { colors, spacing, font } from "../constants/theme";

interface StatCardProps {
  label: string;
  value: number;
  /** Highlights the value in brand green — used for the "Perfect" stat on the results screen. */
  emphasize?: boolean;
}

export function StatCard({ label, value, emphasize }: StatCardProps) {
  return (
    <Card style={styles.card} highlighted={emphasize}>
      <Text style={[styles.value, emphasize && styles.valueEmphasized]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { width: "47%", alignItems: "center", paddingVertical: spacing.lg },
  value: { fontSize: 26, fontFamily: font.w800, color: colors.foreground },
  valueEmphasized: { color: colors.brandText },
  label: { color: colors.muted, fontSize: 12, marginTop: spacing.xs },
});
