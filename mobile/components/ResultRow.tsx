import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, font } from "../constants/theme";
import { SelectionBadge, type ResultLabelOverrides, type SelectionResult } from "./StatusBadge";

interface ResultRowProps {
  name: string;
  statLine: string;
  result: SelectionResult;
  labels?: ResultLabelOverrides;
}

/** One selected player's settled result — used on the My Entry detail screen. */
export function ResultRow({ name, statLine, result, labels }: ResultRowProps) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.stat}>{statLine}</Text>
      </View>
      <SelectionBadge result={result} labels={labels} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surfaceRaised,
    borderRadius: 10,
    padding: spacing.md,
    gap: spacing.sm,
  },
  name: { color: colors.foreground, fontSize: 14, fontFamily: font.w600 },
  stat: { color: colors.muted2, fontSize: 12, marginTop: 2 },
});
