import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, font } from "../constants/theme";

interface InfoRowProps {
  label: string;
  value: string;
  /** Draws the value in brand green — used for a highlighted amount, e.g. an entry fee. */
  emphasize?: boolean;
}

/** Label/value line used in the round-detail info card and the entry confirmation summary. */
export function InfoRow({ label, value, emphasize }: InfoRowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, emphasize && styles.valueEmphasized]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between" },
  label: { color: colors.muted, fontSize: 13 },
  value: { color: colors.foreground, fontSize: 13, fontFamily: font.w700 },
  valueEmphasized: { color: colors.brandText },
});
