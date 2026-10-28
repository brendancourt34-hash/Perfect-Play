import { StyleSheet, Text } from "react-native";
import { colors, spacing, typography } from "../constants/theme";

/** Small tracked uppercase eyebrow label above a list/section, e.g. "GAMES", "WINNERS". */
export function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.label}>{children}</Text>;
}

const styles = StyleSheet.create({
  label: { ...typography.overline, color: colors.muted, marginBottom: spacing.sm },
});
