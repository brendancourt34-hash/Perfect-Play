import { StyleSheet, Text, View } from "react-native";
import { colors, font } from "../constants/theme";
import { PPMark } from "./PPMark";

const SIZES = {
  sm: { markSize: 22, captionSize: 8 },
  md: { markSize: 34, captionSize: 10 },
  lg: { markSize: 54, captionSize: 13 },
  /** ~13% larger than "lg" — Home screen only (see app/(tabs)/index.tsx). */
  xl: { markSize: 61, captionSize: 15 },
} as const;

interface LogoProps {
  size?: keyof typeof SIZES;
  /** Shows the tracked "PERFECT PLAY" caption beneath the mark — only used on splash-style screens (Home, auth). */
  withCaption?: boolean;
}

/** The Perfect Play "PP" brand mark — see components/PPMark.tsx for the logo asset it renders. */
export function Logo({ size = "md", withCaption = false }: LogoProps) {
  const { markSize, captionSize } = SIZES[size];
  return (
    <View style={styles.container}>
      <PPMark size={markSize} />
      {withCaption && (
        <Text style={[styles.caption, { fontSize: captionSize, letterSpacing: captionSize * 0.35 }]}>PERFECT PLAY</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center" },
  caption: { color: colors.muted, fontFamily: font.w700, marginTop: 2, textTransform: "uppercase" },
});
