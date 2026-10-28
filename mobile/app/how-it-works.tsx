import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Card } from "../components/Card";
import { PrizeExplainer } from "../components/PrizeExplainer";
import { colors, spacing, typography } from "../constants/theme";

const STEPS = [
  {
    number: "1",
    title: "Pick the Perfect Round",
    body: "Pick one player from every game.",
    detail: "NRL — a try scorer.\nAFL — a goal scorer.\nNBA — 25+ points.\nNFL — a touchdown scorer.",
  },
  {
    number: "2",
    title: "Go Perfect",
    body: "Your player needs to score.",
    detail: "Every game must be Perfect.",
  },
  {
    number: "3",
    title: "Take the Entire Pool",
    body: "Go Perfect across the entire round.",
    detail: null,
  },
] as const;

/**
 * Mobile "How Perfect Play Works" screen (Phase 17). Reuses PrizeExplainer for the prize
 * copy rather than duplicating that wording — it's the exact same rule whether it's read
 * here or as the short version on Home.
 */
export default function HowItWorksScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {STEPS.map((step) => (
        <Card key={step.number} style={styles.stepCard}>
          <View style={styles.stepRow}>
            <Text style={styles.stepNumber}>{step.number}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.stepTitle}>{step.title.toUpperCase()}</Text>
              <Text style={styles.stepBody}>{step.body}</Text>
              {step.detail && <Text style={styles.stepDetail}>{step.detail}</Text>}
            </View>
          </View>
        </Card>
      ))}

      <View style={styles.prizeSection}>
        <PrizeExplainer />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.md },
  stepCard: { gap: 0 },
  stepRow: { flexDirection: "row", gap: spacing.lg, alignItems: "flex-start" },
  stepNumber: { ...typography.display, color: colors.brand, width: 36 },
  stepTitle: { ...typography.overline, color: colors.foreground },
  stepBody: { color: colors.foreground, fontSize: 15, fontWeight: "700", marginTop: spacing.xs },
  stepDetail: { color: colors.muted, fontSize: 13, marginTop: spacing.xs, lineHeight: 19 },
  prizeSection: { marginTop: spacing.lg },
});
