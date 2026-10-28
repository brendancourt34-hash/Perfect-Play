import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as api from "../lib/api";
import { ErrorState, LoadingState } from "../components/ScreenStates";
import { colors, spacing, typography, font } from "../constants/theme";
import { formatAuDate } from "../lib/format";

/**
 * Perfect Play Terms & Conditions viewing screen — reachable from Account, from registration
 * (before creating an account), and from the wallet before a first deposit. Always shows
 * the currently published version, rendered as an accordion so a long legal document
 * doesn't read as one unbroken wall of text. This is DRAFT content pending real
 * Australian gambling-law legal review (see the content itself for the exact sections
 * still marked "TO BE CONFIRMED").
 */
export default function TermsScreen() {
  const [terms, setTerms] = useState<api.TermsContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);

  const load = useCallback(async () => {
    const result = await api.getTerms();
    if (result.ok) {
      setTerms(result.data.terms);
      setError(null);
    } else {
      setError(result.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!terms && !error) return <LoadingState label="Loading Terms & Conditions…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!terms) return null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.meta}>
        Version {terms.versionNumber} · Effective {formatAuDate(terms.effectiveDate)}
      </Text>
      <Text style={styles.draftNotice}>
        DRAFT — pending legal review. Real-money deposits, entries, and withdrawals remain disabled until this is
        finalised.
      </Text>

      {terms.content.map((section, i) => {
        const expanded = expandedIndex === i;
        return (
          <View key={i} style={styles.section}>
            <Pressable
              onPress={() => setExpandedIndex(expanded ? null : i)}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              style={styles.sectionHeader}
            >
              <Text style={styles.sectionHeading}>{section.heading}</Text>
              <Text style={styles.sectionToggle}>{expanded ? "−" : "+"}</Text>
            </Pressable>
            {expanded && <Text style={styles.sectionBody}>{section.body}</Text>}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  meta: { color: colors.muted, fontSize: 12 },
  draftNotice: {
    color: colors.foreground,
    fontSize: 12,
    backgroundColor: colors.neutralSoft,
    borderWidth: 1,
    borderColor: colors.neutralBorder,
    borderRadius: 10,
    padding: spacing.sm,
    lineHeight: 17,
  },
  section: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.sm },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.sm },
  sectionHeading: { ...typography.bodyStrong, color: colors.foreground, flex: 1, paddingRight: spacing.sm },
  sectionToggle: { color: colors.brandText, fontSize: 18, fontFamily: font.w800 },
  sectionBody: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.xs },
});
