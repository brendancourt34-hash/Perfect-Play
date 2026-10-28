import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, font } from "../constants/theme";

/** Small bordered day/month chip — e.g. "12" over "AUG" — used on upcoming-competition rows. */
export function DateChip({ date }: { date: Date }) {
  const day = new Intl.DateTimeFormat("en-AU", { day: "numeric", timeZone: "Australia/Sydney" }).format(date);
  const month = new Intl.DateTimeFormat("en-AU", { month: "short", timeZone: "Australia/Sydney" }).format(date).toUpperCase();

  return (
    <View style={styles.chip}>
      <Text style={styles.day}>{day}</Text>
      <Text style={styles.month}>{month}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  day: { color: colors.foreground, fontSize: 13, fontFamily: font.w800, lineHeight: 15 },
  month: { color: colors.muted2, fontSize: 8, fontFamily: font.w800, marginTop: 1 },
});
