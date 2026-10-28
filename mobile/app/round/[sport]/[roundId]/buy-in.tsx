import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as api from "../../../../lib/api";
import { isSportSlug, SPORTS } from "../../../../constants/sports";
import { useEntryDraft } from "../../../../lib/entry-draft-context";
import { Button } from "../../../../components/Button";
import { Logo } from "../../../../components/Logo";
import { SectionLabel } from "../../../../components/SectionLabel";
import { CompetitionStateBadge } from "../../../../components/StatusBadge";
import { ErrorState, LoadingState } from "../../../../components/ScreenStates";
import { colors, spacing, typography, font } from "../../../../constants/theme";
import { formatAudCents } from "../../../../lib/format";

/**
 * Round-specific buy-in gate, shown after the user has picked a round and before they
 * can pick players — see docs/phase16-buy-in-flow.md, updated for Phase 23's multi-entry
 * packages. This screen never charges anything itself: the real purchase (a wallet debit
 * for the chosen entry package) happens on the Review screen once picks are made. Up to
 * `maxEntries` independent entries are allowed per user per round (Phase 23) — this is no
 * longer a single-entry gate, just a display of how many the user already holds.
 */
export default function BuyInScreen() {
  const { sport: sportParam, roundId: roundIdParam } = useLocalSearchParams<{ sport: string; roundId: string }>();
  const router = useRouter();
  const sportSlug = isSportSlug(sportParam) ? sportParam : null;
  const roundId = Number(roundIdParam);

  const { roundDetail, setRoundDetail } = useEntryDraft();
  const [error, setError] = useState<string | null>(null);
  const [myEntries, setMyEntries] = useState<api.MyRoundEntry[] | undefined>(undefined);
  const [maxEntries, setMaxEntries] = useState(10);

  const load = useCallback(async () => {
    if (!sportSlug || !Number.isInteger(roundId)) return;
    const [roundResult, entriesResult] = await Promise.all([api.getRoundDetail(sportSlug, roundId), api.getMyRoundEntries(sportSlug, roundId)]);
    if (roundResult.ok) {
      setRoundDetail(roundResult.data);
      setError(null);
    } else {
      setError(roundResult.message);
      return;
    }
    if (entriesResult.ok) {
      setMyEntries(entriesResult.data.entries);
      setMaxEntries(entriesResult.data.maxEntries);
    } else {
      // Non-fatal — worst case the user sees the buy-in screen and finds out about the
      // cap at purchase time instead, where it's still authoritatively enforced.
      setMyEntries([]);
    }
  }, [sportSlug, roundId, setRoundDetail]);

  useEffect(() => {
    // Always refetch (never trust a stale cached roundDetail for a payment gate) — this
    // screen re-checks the exact same lifecycle state the server will re-check anyway.
    load();
  }, [load]);

  if (!sportSlug) return <ErrorState message="Unknown sport." />;
  const sport = SPORTS[sportSlug];

  if (!roundDetail && !error) return <LoadingState label="Loading entry details…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!roundDetail) return null;

  const { competition, round } = roundDetail;
  const roundLabel = `Round ${round.roundNumber}`;
  const tagline = `${sport.pickLabel} Get every pick right to go PERFECT.`;
  const entryCount = myEntries?.length ?? 0;
  const atCap = entryCount >= maxEntries;

  return (
    <View style={styles.container}>
      <View style={styles.brand}>
        <Logo size="sm" />
      </View>

      <Text style={styles.sportName}>{sport.name}</Text>
      <Text style={styles.roundName}>{roundLabel.toUpperCase()}</Text>
      <Text style={styles.tagline}>{tagline}</Text>

      {myEntries === undefined ? (
        <LoadingState />
      ) : atCap ? (
        <View style={styles.card}>
          <Text style={styles.stateTitle}>Maximum Entries Reached</Text>
          <Text style={styles.stateBody}>
            You have {entryCount}/{maxEntries} entries in this round — that&apos;s the maximum allowed.
          </Text>
          <Button label="View my entries" onPress={() => router.push("/(tabs)/my-entries")} style={{ marginTop: spacing.lg }} />
        </View>
      ) : competition.state !== "open" ? (
        <View style={styles.card}>
          <View style={{ marginBottom: spacing.sm }}>
            <CompetitionStateBadge state={competition.state} />
          </View>
          <Text style={styles.stateTitle}>
            {competition.state === "not_yet_open" ? "Not Yet Open" : competition.state === "closed" ? "Entry Closed" : "Competition Complete"}
          </Text>
          <Text style={styles.stateBody}>
            {competition.state === "not_yet_open"
              ? "Entries for this round aren't open yet."
              : competition.state === "closed"
                ? "This competition is no longer accepting entries."
                : "This competition has already been settled."}
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          <SectionLabel>Entry</SectionLabel>
          <Text style={styles.price}>From {formatAudCents(competition.entryFeeCents)} AUD</Text>
          {entryCount > 0 && (
            <Text style={styles.entryCountNote}>
              You have {entryCount}/{maxEntries} entries in this round.
            </Text>
          )}
          <Button
            label={entryCount > 0 ? "Buy more entries" : "Make your picks"}
            // The customer picks the perfect round exactly once per sport/round: with
            // existing entries already in place, skip the picking screen entirely and go
            // straight to review, which shows their existing picks (fetched server-side)
            // read-only and lets them choose how many more entries to buy — never a
            // second, independent selection process.
            onPress={() => router.push(`/round/${sportSlug}/${roundId}/${entryCount > 0 ? "review" : "enter"}`)}
            style={{ marginTop: spacing.lg }}
          />
          <Text style={styles.howItWorksLink} onPress={() => router.push("/how-it-works")}>
            How does this work? »
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.xl, justifyContent: "center" },
  brand: { marginBottom: spacing.xl, alignItems: "flex-start" },
  sportName: { ...typography.display, fontSize: 64, lineHeight: 62, color: colors.foreground },
  roundName: { color: colors.brandText, fontFamily: font.display, fontSize: 26, textTransform: "uppercase" },
  tagline: { color: colors.muted, marginTop: spacing.md, fontSize: 15, lineHeight: 22, fontFamily: font.w500 },
  card: { width: "100%", marginTop: spacing.xxl, paddingTop: spacing.lg, borderTopWidth: 4, borderTopColor: colors.brand },
  price: { fontSize: 48, lineHeight: 50, fontFamily: font.display, color: colors.foreground, textTransform: "uppercase" },
  entryCountNote: { color: colors.muted, fontSize: 13, marginTop: spacing.xs, fontFamily: font.w500 },
  stateTitle: { ...typography.heading, color: colors.foreground, marginBottom: spacing.xs },
  stateBody: { color: colors.muted, fontSize: 14, lineHeight: 20, fontFamily: font.w500 },
  howItWorksLink: { color: colors.brandText, fontSize: 14, fontFamily: font.w600, marginTop: spacing.lg },
});
