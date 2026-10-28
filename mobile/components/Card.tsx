import { StyleSheet, View, type ViewProps } from "react-native";
import { colors, radius, spacing } from "../constants/theme";

interface CardProps extends ViewProps {
  /** Draws a brand-green border instead of the default neutral one — used to mark a completed/selected state. */
  highlighted?: boolean;
}

export function Card({ style, highlighted, ...props }: CardProps) {
  return <View style={[styles.card, highlighted && styles.highlighted, style]} {...props} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing.lg,
  },
  highlighted: { borderColor: colors.brand },
});
