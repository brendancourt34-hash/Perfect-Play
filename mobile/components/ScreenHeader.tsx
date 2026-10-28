import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, typography } from "../constants/theme";

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
}

/** Standard page title block used at the top of every top-level screen. */
export function ScreenHeader({ title, subtitle }: ScreenHeaderProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.lg },
  title: { ...typography.title, color: colors.foreground },
  subtitle: { color: colors.muted, marginTop: spacing.xs, fontSize: 14 },
});
