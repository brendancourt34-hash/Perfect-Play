import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as api from "../../../../lib/api";
import { isSportSlug, SPORTS } from "../../../../constants/sports";
import { useEntryDraft } from "../../../../lib/entry-draft-context";
import { Card } from "../../../../components/Card";
import { Button } from "../../../../components/Button";
import { InfoRow } from "../../../../components/InfoRow";
import { Icon } from "../../../../components/icons";
import { LoadingState } from "../../../../components/ScreenStates";
import { colors, radius, spacing, typography } from "../../../../constants/theme";
import { formatAudCents } from "../../../../lib/format";

export default function ConfirmationScreen() {
  const { sport: sportParam, entryIds: entryIdsParam, amountPaidCents: amountPaidParam, entryCount: entryCountParam } = useLocalSearchParams<{
    sport: string;
    entryIds: string;
    amountPaidCents?: string;
    entryCount?: string;
  }>();
  const router = useRouter();
  const { reset, roundDetail } = useEntryDraft();
  const [loading, setLoading] = useState(true);

  const sportSlug = isSportSlug(sportParam) ? sportParam : null;
  const entryIds = (entryIdsParam ?? "")
    .split(",")
    .map(Number)
    .filter((id) => Number.isInteger(id));
  const amountPaidCents = amountPaidParam ? Number(amountPaidParam) : null;
  const entryCount = entryCountParam ? Number(entryCountParam) : entryIds.length;

  useEffect(() => {
    // The entries are already created server-side by the time this screen renders — this
    // just clears the local draft so a future visit to /enter starts fresh.
    reset();
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!sportSlug || entryIds.length === 0) return <LoadingState />;
  if (loading || !roundDetail) return <LoadingState />;
  const sport = SPORTS[sportSlug];

  return (
    <View style={styles.container}>
      <View style={styles.checkCircle}>
        <Icon name="checkCircle" size={36} color={colors.brand} />
      </View>
      <Text style={styles.title}>{entryCount === 1 ? "Your Perfect Round is locked in" : `${entryCount} Perfect Rounds are locked in`}</Text>

      <Card style={styles.card}>
        <InfoRow label="Competition" value={`Perfect Play ${sport.name}`} />
        <InfoRow label="Round" value={roundDetail.round.name ?? `Round ${roundDetail.round.roundNumber}`} />
        <InfoRow label="Entries" value={entryIds.map((id) => `#${id}`).join(", ")} />
        {amountPaidCents !== null && <InfoRow label="Amount paid" value={formatAudCents(amountPaidCents)} emphasize />}
        <InfoRow label="Payment" value="Paid from your Perfect Play Balance" />
      </Card>

      <Text style={styles.notice}>
        Get every pick right to go PERFECT. GO PERFECT — TAKE THE ENTIRE POOL. If more than one entry goes PERFECT,
        the pool is split evenly.{" "}
        {entryCount === 1
          ? "Your picks are locked in and can't be changed once the round closes."
          : "Every entry uses the same picks and is tracked independently — each can win or miss on its own. Picks are locked in and can't be changed once the round closes."}
      </Text>

      <View style={styles.actions}>
        <Button label={entryCount === 1 ? "View my entry" : "View my entries"} onPress={() => router.replace(entryCount === 1 ? `/entry/${entryIds[0]}` : "/(tabs)/my-entries")} />
        <Button
          label="Back to round"
          variant="secondary"
          onPress={() => router.replace(`/round/${sportSlug}/${roundIdFromDetail(roundDetail)}`)}
          style={{ marginTop: spacing.sm }}
        />
      </View>
    </View>
  );
}

function roundIdFromDetail(detail: api.RoundDetail): number {
  return detail.round.id;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.xl, alignItems: "center" },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.brandBorder,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xl,
  },
  title: { ...typography.title, fontSize: 24, color: colors.foreground, marginTop: spacing.md, marginBottom: spacing.xl },
  card: { width: "100%", gap: spacing.sm },
  notice: {
    marginTop: spacing.lg,
    color: colors.muted,
    backgroundColor: colors.neutralSoft,
    borderWidth: 1,
    borderColor: colors.neutralBorder,
    padding: spacing.md,
    borderRadius: 10,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  actions: { width: "100%", marginTop: spacing.xl },
});
