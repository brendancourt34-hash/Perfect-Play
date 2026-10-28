import { StyleSheet, Text, View } from "react-native";
import { colors, font } from "../constants/theme";

/**
 * The Perfect Play brand mark — Option D "Scoreboard": a slanted jersey-red block with a
 * condensed "P". Drawn natively (no image asset) so it stays crisp at every size. The old
 * green PNG (assets/pp-logo.png) is kept on disk for the app icon until a red icon is made.
 */
export function PPMark({ size = 32 }: { size?: number }) {
  return (
    <View
      accessibilityLabel="Perfect Play"
      accessibilityRole="image"
      style={[styles.block, { width: size, height: size, transform: [{ skewX: "-12deg" }] }]}
    >
      <Text style={[styles.letter, { fontSize: size * 0.68, lineHeight: size * 0.9, transform: [{ skewX: "12deg" }] }]}>P</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  letter: { color: colors.onBrand, fontFamily: font.display },
});
