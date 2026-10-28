import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors, spacing, font } from "../constants/theme";
import { Button } from "./Button";
import { Icon } from "./icons";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={colors.brandText} size="large" />
      <Text style={styles.mutedText}>{label}</Text>
    </View>
  );
}

/** Never shows a raw error/stack trace — always a plain, retryable message. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <View style={styles.iconCircle}>
        <Icon name="xCircle" size={24} color={colors.muted} />
      </View>
      <Text style={styles.errorTitle}>Something went wrong</Text>
      <Text style={styles.mutedText}>{message}</Text>
      {onRetry && <Button label="Try again" variant="secondary" onPress={onRetry} style={{ marginTop: spacing.lg }} />}
    </View>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {description && <Text style={styles.mutedText}>{description}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", padding: spacing.xxl, gap: spacing.sm },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.neutralSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  mutedText: { color: colors.muted, fontSize: 14, textAlign: "center" },
  errorTitle: { color: colors.foreground, fontSize: 16, fontFamily: font.w700 },
  emptyTitle: { color: colors.foreground, fontSize: 16, fontFamily: font.w700, textAlign: "center" },
});
