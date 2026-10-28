import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, font } from "../constants/theme";

interface PillProps {
  label: string;
  tone?: "brand" | "neutral";
}

/** Small rounded chip — e.g. the "$5 Entry" tag on a round or sport card. */
export function Pill({ label, tone = "neutral" }: PillProps) {
  return (
    <View style={[styles.pill, tone === "brand" ? styles.brand : styles.neutral]}>
      <Text style={[styles.text, tone === "brand" && styles.textBrand]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderWidth: 1,
  },
  neutral: { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
  brand: { backgroundColor: colors.brandSoft, borderColor: colors.brandBorder },
  text: { color: colors.foreground, fontSize: 12, fontFamily: font.w700 },
  textBrand: { color: colors.brandText },
});
