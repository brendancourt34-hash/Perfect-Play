import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as api from "../../../../lib/api";
import { isSportSlug, SPORTS } from "../../../../constants/sports";
import { useEntryDraft } from "../../../../lib/entry-draft-context";
import { Button } from "../../../../components/Button";
import { SectionLabel } from "../../../../components/SectionLabel";
import { ErrorState, LoadingState } from "../../../../components/ScreenStates";
import { colors, spacing, typography, font } from "../../../../constants/theme";
import { formatAudCents } from "../../../../lib/format";

type Stage = "idle" | "paying" | "failed" | "cancelled";

/**
 * Test-payment step between Buy-In and Picks (docs/phase16-buy-in-flow.md §17). This
 * screen never decides success/failure itself — it calls the real (currently dev-only)
 * payment provider via POST .../payment and renders whatever it reports. No entry is
 * created here or by that endpoint; the entry is created at final submission (Review),
 * which independently re-runs its own charge. This is a UX gate only.
 */
export default function TestPaymentScreen() {
  const { sport: sportParam, roundId: roundIdParam } = useLocalSearchParams<{ sport: string; roundId: string }>();
  const router = useRouter();
  const sportSlug = isSportSlug(sportParam) ? sportParam : null;
  const roundId = Number(roundIdParam);

  const { roundDetail, setRoundDetail } = useEntryDraft();
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [failureMessage, setFailureMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sportSlug || !Number.isInteger(roundId)) return;
    const result = await api.getRoundDetail(sportSlug, roundId);
    if (result.ok) {
      setRoundDetail(result.data);
      setError(null);
    } else {
      setError(result.message);
    }
  }, [sportSlug, roundId, setRoundDetail]);

  useEffect(() => {
    if (!roundDetail) load();
  }, [roundDetail, load]);

  if (!sportSlug) return <ErrorState message="Unknown sport." />;
  const sport = SPORTS[sportSlug];

  if (!roundDetail && !error) return <LoadingState label="Loading…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!roundDetail) return null;

  const { competition, round } = roundDetail;
  const roundLabel = `Round ${round.roundNumber}`;
  const amountLabel = formatAudCents(competition.entryFeeCents);

  async function handlePay() {
    if (!sportSlug) return;
    setStage("paying");
    const result = await api.initiatePayment(sportSlug, roundId);
    if (!result.ok) {
      setFailureMessage(result.errors?.[0] ?? result.message);
      setStage("failed");
      return;
    }
    if (result.data.status === "failed" || result.data.status === "cancelled") {
      setFailureMessage(result.data.message);
      setStage("failed");
      return;
    }
    // "pending" (dev mode — no live provider connected) or "paid" both mean: proceed.
    router.replace(`/round/${sportSlug}/${roundId}/enter`);
  }

  return (
    <View style={styles.container}>
      {stage === "failed" ? (
        <View style={styles.card}>
          <Text style={styles.stateTitle}>Payment Failed</Text>
          <Text style={styles.stateBody}>{failureMessage ?? "Your payment was not completed."}</Text>
          <Button label="Try again" onPress={() => setStage("idle")} style={{ marginTop: spacing.lg }} />
        </View>
      ) : stage === "cancelled" ? (
        <View style={styles.card}>
          <Text style={styles.stateTitle}>Payment Cancelled</Text>
          <Button label="Back to round" variant="secondary" onPress={() => router.back()} style={{ marginTop: spacing.lg }} />
        </View>
      ) : (
        <View style={styles.card}>
          <SectionLabel>Entry</SectionLabel>
          <Text style={styles.sportName}>
            {sport.name} — {roundLabel}
          </Text>
          <Text style={styles.price}>{amountLabel} AUD</Text>
          <Text style={styles.testLabel}>Test Payment</Text>
          <Text style={styles.testNote}>No real payment provider is connected yet — no money will be charged.</Text>

          <Button label={`Pay ${amountLabel}`} onPress={handlePay} loading={stage === "paying"} style={{ marginTop: spacing.xl }} />
          <Button
            label="Cancel"
            variant="secondary"
            onPress={() => setStage("cancelled")}
            disabled={stage === "paying"}
            style={{ marginTop: spacing.sm }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.xl, alignItems: "center", justifyContent: "center" },
  card: { width: "100%", alignItems: "center" },
  sportName: { ...typography.heading, color: colors.foreground, textAlign: "center", marginTop: spacing.sm },
  price: { fontSize: 40, fontFamily: font.w800, color: colors.foreground, marginTop: spacing.md },
  testLabel: { ...typography.overline, color: colors.brandText, marginTop: spacing.lg },
  testNote: { color: colors.muted2, fontSize: 12, textAlign: "center", marginTop: spacing.xs, lineHeight: 17 },
  stateTitle: { ...typography.heading, color: colors.foreground, marginBottom: spacing.xs },
  stateBody: { color: colors.muted, textAlign: "center", fontSize: 14, lineHeight: 20 },
});
