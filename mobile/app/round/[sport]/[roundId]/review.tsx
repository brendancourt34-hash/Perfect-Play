import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as api from "../../../../lib/api";
import { isSportSlug, SPORTS } from "../../../../constants/sports";
import { useEntryDraft } from "../../../../lib/entry-draft-context";
import { Card } from "../../../../components/Card";
import { Button } from "../../../../components/Button";
import { ErrorState, LoadingState } from "../../../../components/ScreenStates";
import { colors, spacing, typography, font } from "../../../../constants/theme";
import { formatAudCents } from "../../../../lib/format";

/** Per-entry price of the cheapest (1-entry) package, used only to compute the "save $X" badge — never used as the actual charge, which always comes from the selected package's own priceCents. */
function perEntryBaseline(packages: api.EntryPackageSummary[]): number {
  const one = packages.find((p) => p.entryCount === 1);
  return one ? one.priceCents : 500;
}

/** A fresh, sufficiently-random key for one purchase attempt — the server namespaces this with the real authenticated userId, so only same-user, same-attempt collisions matter here. */
function generateIdempotencyKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function ReviewScreen() {
  const { sport: sportParam, roundId: roundIdParam } = useLocalSearchParams<{ sport: string; roundId: string }>();
  const router = useRouter();
  const sportSlug = isSportSlug(sportParam) ? sportParam : null;
  const roundId = Number(roundIdParam);

  const { picks, roundDetail, setRoundDetail } = useEntryDraft();
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  // Stable for this screen's whole lifetime — a double-tap of "Enter" or a network retry
  // reuses the exact same key, so the server resolves them to one purchase, never two.
  const [idempotencyKey] = useState(generateIdempotencyKey);

  const [packages, setPackages] = useState<api.EntryPackageSummary[] | null>(null);
  const [existingEntryCount, setExistingEntryCount] = useState(0);
  const [maxEntries, setMaxEntries] = useState(10);
  const [sharedSelections, setSharedSelections] = useState<api.CreateEntrySelection[] | null>(null);
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The customer picks the perfect round exactly once. A fresh entry arrives here with
  // `picks` already set (from the picking screen); a "buy more entries" purchase skips
  // the picking screen entirely (see buy-in.tsx) and arrives with `picks` empty — in that
  // case the existing, already-submitted selection set (sharedSelections, from the real
  // server-side record) is what's shown and reused, never a fresh pick.
  const hasLocalPicks = Object.keys(picks).length > 0;

  const load = useCallback(async () => {
    if (!sportSlug || !Number.isInteger(roundId)) return;
    const [packagesResult, entriesResult, balanceResult, roundResult] = await Promise.all([
      api.getEntryPackages(),
      api.getMyRoundEntries(sportSlug, roundId),
      api.getWalletBalance(),
      // Only needed when arriving without a cached roundDetail (the "buy more entries,
      // skip picking" path) — harmless/cheap to also refetch on the normal path.
      roundDetail ? Promise.resolve({ ok: true as const, data: roundDetail }) : api.getRoundDetail(sportSlug, roundId),
    ]);
    if (!packagesResult.ok) {
      setLoadError(packagesResult.message);
      return;
    }
    setPackages(packagesResult.data.packages);
    if (entriesResult.ok) {
      setExistingEntryCount(entriesResult.data.entries.length);
      setMaxEntries(entriesResult.data.maxEntries);
      setSharedSelections(entriesResult.data.sharedSelections);
    }
    if (balanceResult.ok) setBalanceCents(balanceResult.data.balanceCents);
    if (roundResult.ok) setRoundDetail(roundResult.data);
    else setLoadError(roundResult.message);

    const fittingPackages = packagesResult.data.packages.filter(
      (p) => (entriesResult.ok ? entriesResult.data.entries.length : 0) + p.entryCount <= (entriesResult.ok ? entriesResult.data.maxEntries : 10),
    );
    setSelectedPackageId(fittingPackages[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- roundDetail intentionally excluded: only used to decide whether a fetch is needed, never to re-trigger this load.
  }, [sportSlug, roundId, setRoundDetail]);

  useEffect(() => {
    load();
  }, [load]);

  if (!sportSlug) return <ErrorState message="Unknown sport." />;
  const sport = SPORTS[sportSlug];

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!packages || !roundDetail) return <LoadingState label="Loading entry options…" />;

  const openGames = roundDetail.games.filter((g) => g.status === "scheduled");
  const baseline = perEntryBaseline(packages);
  const selectedPackage = packages.find((p) => p.id === selectedPackageId) ?? null;
  const remainingCap = Math.max(0, maxEntries - existingEntryCount);

  // The ONE set of picks actually being reviewed/purchased: freshly-made local picks if
  // any exist, otherwise the customer's existing shared selection set for this
  // competition (reused, never re-picked) — see hasLocalPicks above.
  const sharedByGameId = new Map((sharedSelections ?? []).map((s) => [s.gameId, s.playerIds[0]]));
  function effectivePick(gameId: number): number | undefined {
    return hasLocalPicks ? picks[gameId] : sharedByGameId.get(gameId);
  }

  function playerName(gameId: number, playerId: number | undefined): string {
    if (!playerId || !roundDetail) return "—";
    const game = roundDetail.games.find((g) => g.id === gameId);
    return game?.eligiblePlayers.find((p) => p.id === playerId)?.name ?? "Unknown player";
  }

  async function handleSubmit() {
    if (!sportSlug || !selectedPackage) return;
    setSubmitting(true);
    setErrors([]);
    // ONE selection set is sent, never one array per entry — the server creates
    // `selectedPackage.entryCount` identical entries from it, and (on a "buy more"
    // purchase) ignores this entirely in favor of the customer's already-existing
    // selections, so it's always safe to send the one set currently being shown.
    const selections = openGames.map((g) => ({ gameId: g.id, playerIds: [effectivePick(g.id)!] }));
    const result = await api.enterPackage(sportSlug, roundId, selectedPackage.id, selections, idempotencyKey);
    setSubmitting(false);
    if (result.ok) {
      const entryIdsParam = result.data.entryIds.join(",");
      router.replace(
        `/round/${sportSlug}/${roundId}/confirmation?entryIds=${entryIdsParam}&amountPaidCents=${result.data.amountPaidCents}&entryCount=${result.data.entryCount}`,
      );
    } else {
      setErrors(result.errors ?? [result.message]);
    }
  }

  const insufficientFunds = balanceCents !== null && selectedPackage !== null && balanceCents < selectedPackage.priceCents;

  return (
    <View style={styles.container}>
      <FlatList
        data={openGames}
        keyExtractor={(g) => String(g.id)}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Lock it in</Text>
            <Text style={styles.subtitle}>
              {sport.name} {`Round ${roundDetail.round.roundNumber}`} · One set of picks. Get every one right to go
              PERFECT.
            </Text>
            {!hasLocalPicks && sharedSelections && (
              <Text style={styles.reuseNote}>These are your existing picks for this round — you&apos;re adding more entries with the same picks.</Text>
            )}
          </View>
        }
        renderItem={({ item: game, index }) => (
          <Card style={styles.gameCard}>
            <Text style={styles.gameLabel}>
              {index + 1} · {game.homeTeam.name} vs {game.awayTeam.name}
            </Text>
            <Text style={styles.playerLine}>{playerName(game.id, effectivePick(game.id))}</Text>
          </Card>
        )}
        ListFooterComponent={
          <View style={styles.footerContent}>
            <View style={styles.packagesSection}>
              <Text style={styles.sectionTitle}>How many entries?</Text>
              <Text style={styles.entryCountNote}>
                All entries use the same picks above. You have {existingEntryCount}/{maxEntries} entries in this round — each is tracked
                independently.
              </Text>
              {remainingCap === 0 ? (
                <Text style={styles.capReachedText}>You&apos;ve reached the maximum of {maxEntries} entries in this round.</Text>
              ) : (
                packages.map((pkg) => {
                  const fits = existingEntryCount + pkg.entryCount <= maxEntries;
                  const saveCents = pkg.entryCount * baseline - pkg.priceCents;
                  return (
                    <Pressable
                      key={pkg.id}
                      disabled={!fits}
                      onPress={() => setSelectedPackageId(pkg.id)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: selectedPackageId === pkg.id, disabled: !fits }}
                    >
                      <View style={[styles.packageCard, selectedPackageId === pkg.id && styles.packageCardSelected, !fits && styles.packageCardDisabled]}>
                        <View style={[styles.packageNumber, selectedPackageId === pkg.id && styles.packageNumberSelected]}>
                          <Text style={[styles.packageNumberText, selectedPackageId === pkg.id && styles.packageNumberTextSelected]}>{pkg.entryCount}</Text>
                        </View>
                        <View style={styles.packageRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.packageLabel}>{pkg.label}</Text>
                            <Text style={styles.packageEach}>{formatAudCents(Math.round(pkg.priceCents / pkg.entryCount))} per entry</Text>
                            {saveCents > 0 && <Text style={styles.packageSave}>Save {formatAudCents(saveCents)}</Text>}
                            {!fits && <Text style={styles.packageDisabledNote}>Would exceed the {maxEntries}-entry limit</Text>}
                          </View>
                          <View style={styles.packagePriceBlock}>
                            <Text style={styles.packagePrice}>{formatAudCents(pkg.priceCents)}</Text>
                            {pkg.badge && <Text style={styles.packageBadge}>{pkg.badge}</Text>}
                          </View>
                        </View>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </View>

            {selectedPackage && (
              <Text style={styles.shareLine}>
                Go PERFECT and you hold <Text style={styles.shareAccent}>{selectedPackage.entryCount} {selectedPackage.entryCount === 1 ? "share" : "shares"}</Text> of
                the pool. Nobody else PERFECT? You take the lot.
              </Text>
            )}

            <View style={styles.balanceRow}>
              <Text style={styles.balanceText}>Perfect Play Balance: {balanceCents === null ? "—" : formatAudCents(balanceCents)}</Text>
              <Text style={styles.addFundsLink} onPress={() => router.push("/wallet")}>
                Add funds
              </Text>
            </View>
            {insufficientFunds && (
              <Text style={styles.insufficientText}>Your balance doesn&apos;t cover this package — add funds above before entering.</Text>
            )}

            {errors.length > 0 && (
              <View style={styles.errorBox}>
                {errors.map((e, i) => (
                  <Text key={i} style={styles.errorText}>
                    {e}
                  </Text>
                ))}
              </View>
            )}
          </View>
        }
      />

      <View style={styles.footer}>
        {hasLocalPicks && (
          <Button label="Edit picks" variant="secondary" onPress={() => router.back()} style={{ marginBottom: spacing.sm }} />
        )}
        <Button
          label={selectedPackage ? `Pay ${formatAudCents(selectedPackage.priceCents)} · Lock it in »` : "Choose a package"}
          onPress={handleSubmit}
          loading={submitting}
          disabled={!selectedPackage}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: 6 },
  header: { paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: { ...typography.title, color: colors.foreground },
  subtitle: { color: colors.muted, fontSize: 13, fontFamily: font.w500, marginTop: spacing.xs, lineHeight: 18 },
  reuseNote: { color: colors.muted, fontSize: 12, fontFamily: font.w500, marginTop: spacing.sm },
  gameCard: { gap: 2, paddingVertical: spacing.md, borderLeftWidth: 4, borderLeftColor: colors.brand },
  gameLabel: { color: colors.muted, fontSize: 13, fontFamily: font.displayBold, textTransform: "uppercase", marginBottom: 2 },
  playerLine: { color: colors.foreground, fontSize: 16, fontFamily: font.w700 },
  footerContent: { marginTop: spacing.md, gap: spacing.md },
  packagesSection: { gap: spacing.sm, paddingTop: spacing.md },
  sectionTitle: { ...typography.title, color: colors.foreground },
  entryCountNote: { color: colors.muted, fontSize: 13, fontFamily: font.w500, lineHeight: 18 },
  capReachedText: { color: colors.foreground, fontSize: 13, fontFamily: font.w500, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  packageCard: { flexDirection: "row", alignItems: "stretch", minHeight: 72, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border },
  packageCardSelected: { borderColor: colors.brand },
  packageCardDisabled: { opacity: 0.4 },
  packageNumber: { width: 72, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  packageNumberSelected: { backgroundColor: colors.brand },
  packageNumberText: { color: colors.muted, fontFamily: font.display, fontSize: 36 },
  packageNumberTextSelected: { color: colors.onBrand },
  packageRow: { flex: 1, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.md },
  packageLabel: { color: colors.foreground, fontSize: 18, fontFamily: font.display, textTransform: "uppercase" },
  packageEach: { color: colors.muted, fontSize: 12, fontFamily: font.w500 },
  packageSave: { color: colors.brandText, fontSize: 12, fontFamily: font.w600, marginTop: 2 },
  packageDisabledNote: { color: colors.muted2, fontSize: 11, fontFamily: font.w500, marginTop: 2 },
  packagePriceBlock: { alignItems: "flex-end" },
  packagePrice: { color: colors.foreground, fontSize: 26, fontFamily: font.display },
  packageBadge: {
    color: colors.onBrand,
    backgroundColor: colors.brand,
    fontSize: 10,
    fontFamily: font.w700,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
    overflow: "hidden",
    textTransform: "uppercase",
  },
  shareLine: { color: colors.foreground, fontSize: 14, fontFamily: font.w500, lineHeight: 20 },
  shareAccent: { color: colors.brandText, fontFamily: font.w700 },
  balanceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  balanceText: { color: colors.muted, fontSize: 13, fontFamily: font.w500 },
  addFundsLink: { color: colors.brandText, fontSize: 13, fontFamily: font.w700 },
  insufficientText: { color: colors.foreground, fontSize: 12, fontFamily: font.w500, backgroundColor: colors.surface, borderLeftWidth: 4, borderLeftColor: colors.warning, padding: spacing.sm },
  errorBox: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4, borderLeftColor: colors.warning, padding: spacing.md, gap: spacing.xs },
  errorText: { color: colors.foreground, fontSize: 13, fontFamily: font.w500 },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
});
