import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import * as api from "../../lib/api";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";
import { InfoRow } from "../../components/InfoRow";
import { ScreenHeader } from "../../components/ScreenHeader";
import { Screen } from "../../components/Screen";
import { ErrorState } from "../../components/ScreenStates";
import { colors, radius, spacing, typography, font } from "../../constants/theme";
import { formatAudCents } from "../../lib/format";

const PRESET_AMOUNTS_CENTS = [500, 1000, 2000, 5000];

const TRANSACTION_LABELS: Record<api.WalletTransactionSummary["type"], string> = {
  deposit: "Deposit",
  entry_purchase: "Entry purchase",
  winning_credit: "Winnings",
  withdrawal: "Withdrawal",
  refund: "Refund",
  adjustment: "Adjustment",
};

/**
 * Perfect Play Balance — the wallet tab. Real money remains disabled pending Australian
 * gambling-law legal review (docs/phase20-payment-infrastructure.md): "depositing" here
 * runs through the same dev-only payment provider every other Perfect Play charge uses,
 * which can never report a real "paid" charge. Nothing here fakes a live payment.
 */
export default function WalletScreen() {
  const router = useRouter();
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<api.WalletTransactionSummary[]>([]);
  const [withdrawals, setWithdrawals] = useState<api.WithdrawalSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [depositing, setDepositing] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [depositError, setDepositError] = useState<string | null>(null);
  const [depositMessage, setDepositMessage] = useState<string | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawMessage, setWithdrawMessage] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState<boolean | null>(null);
  const [termsVersionId, setTermsVersionId] = useState<number | null>(null);
  const [agreeChecked, setAgreeChecked] = useState(false);
  const [agreeing, setAgreeing] = useState(false);

  const load = useCallback(async () => {
    const [balanceResult, transactionsResult, withdrawalsResult, termsResult] = await Promise.all([
      api.getWalletBalance(),
      api.listWalletTransactions(),
      api.listMyWithdrawals(),
      api.getMyTermsAcceptance(),
    ]);
    if (balanceResult.ok) {
      setBalanceCents(balanceResult.data.balanceCents);
      setError(null);
    } else {
      setError(balanceResult.message);
    }
    if (transactionsResult.ok) setTransactions(transactionsResult.data.transactions);
    if (withdrawalsResult.ok) setWithdrawals(withdrawalsResult.data.withdrawals);
    if (termsResult.ok) {
      setTermsAccepted(termsResult.data.accepted);
      setTermsVersionId(termsResult.data.currentVersion?.id ?? null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDeposit(amountCents: number) {
    setDepositError(null);
    setDepositMessage(null);
    setDepositing(amountCents);
    const result = await api.depositToWallet(amountCents);
    setDepositing(null);
    if (result.ok) {
      setCustomAmount("");
      if (!result.data.confirmed) {
        // Real payment stays disabled pending legal review, so a deposit never actually
        // confirms — the balance genuinely hasn't changed. Say so, rather than implying
        // success like the balance is about to update.
        setDepositMessage(result.data.message ?? "Deposit recorded — no real payment provider is connected yet, so your balance hasn't changed.");
      }
      await load();
    } else {
      setDepositError(result.errors?.[0] ?? result.message);
    }
  }

  function handleCustomDeposit() {
    const dollars = Number(customAmount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setDepositError("Enter a valid dollar amount.");
      return;
    }
    handleDeposit(Math.round(dollars * 100));
  }

  async function handleAgreeToTerms() {
    if (!termsVersionId) return;
    setAgreeing(true);
    const result = await api.acceptTerms(termsVersionId);
    setAgreeing(false);
    if (result.ok) setTermsAccepted(true);
  }

  async function handleRequestWithdrawal() {
    setWithdrawError(null);
    setWithdrawMessage(null);
    const dollars = Number(withdrawAmount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setWithdrawError("Enter a valid dollar amount.");
      return;
    }
    setWithdrawing(true);
    const result = await api.requestWithdrawal(Math.round(dollars * 100));
    setWithdrawing(false);
    if (result.ok) {
      setWithdrawAmount("");
      setWithdrawMessage("Withdrawal requested — an admin will process it.");
      await load();
    } else {
      setWithdrawError(result.errors?.[0] ?? result.message);
    }
  }

  // No full-screen spinner: the page renders straight away and the balance fills in.
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <Screen style={styles.container}>
      <ScreenHeader title="Wallet" />
      <FlatList
        data={transactions}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.headerContent}>
            <Text style={styles.subtitle}>Add funds and view your transaction history.</Text>
            <Card style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>Current balance</Text>
              <Text style={styles.balanceValue}>{balanceCents === null ? "—" : formatAudCents(balanceCents)}</Text>
            </Card>

            <Text style={styles.sectionTitle}>Add funds</Text>
            {termsAccepted === false ? (
              <View style={styles.termsGate}>
                <Text style={styles.termsGateText}>
                  You must agree to the Perfect Play{" "}
                  <Text style={styles.addFundsLink} onPress={() => router.push("/terms")}>
                    Terms & Conditions
                  </Text>{" "}
                  before adding funds.
                </Text>
                <Pressable style={styles.termsRow} onPress={() => setAgreeChecked((prev) => !prev)} accessibilityRole="checkbox" accessibilityState={{ checked: agreeChecked }}>
                  <View style={[styles.checkbox, agreeChecked && styles.checkboxChecked]}>{agreeChecked && <Text style={styles.checkboxMark}>✓</Text>}</View>
                  <Text style={styles.termsGateText}>I have read and agree to the Perfect Play Terms & Conditions and Privacy Policy</Text>
                </Pressable>
                <Button label="Agree & continue" onPress={handleAgreeToTerms} loading={agreeing} disabled={!agreeChecked} style={{ marginTop: spacing.sm }} />
              </View>
            ) : (
              <>
                <View style={styles.presetRow}>
                  {PRESET_AMOUNTS_CENTS.map((amount) => (
                    <Button
                      key={amount}
                      label={formatAudCents(amount)}
                      variant="secondary"
                      loading={depositing === amount}
                      disabled={depositing !== null && depositing !== amount}
                      onPress={() => handleDeposit(amount)}
                      style={styles.presetButton}
                    />
                  ))}
                </View>

                <View style={styles.customRow}>
                  <TextInput
                    style={styles.customInput}
                    placeholder="Custom amount ($)"
                    placeholderTextColor={colors.muted2}
                    keyboardType="decimal-pad"
                    value={customAmount}
                    onChangeText={setCustomAmount}
                  />
                  <Button label="Add" onPress={handleCustomDeposit} loading={depositing !== null} style={styles.customButton} />
                </View>
                {depositError && <Text style={styles.errorText}>{depositError}</Text>}
                {depositMessage && <Text style={styles.successText}>{depositMessage}</Text>}
              </>
            )}

            <Text style={styles.sectionTitle}>Withdraw funds</Text>
            <Text style={styles.withdrawNote}>
              Requests are reviewed by an admin — no real payout mechanism is connected yet. Your balance isn&apos;t
              affected until a withdrawal is completed.
            </Text>
            <View style={styles.customRow}>
              <TextInput
                style={styles.customInput}
                placeholder="Amount to withdraw ($)"
                placeholderTextColor={colors.muted2}
                keyboardType="decimal-pad"
                value={withdrawAmount}
                onChangeText={setWithdrawAmount}
              />
              <Button label="Request" variant="secondary" onPress={handleRequestWithdrawal} loading={withdrawing} style={styles.customButton} />
            </View>
            {withdrawError && <Text style={styles.errorText}>{withdrawError}</Text>}
            {withdrawMessage && <Text style={styles.successText}>{withdrawMessage}</Text>}
            {withdrawals.length > 0 && (
              <View style={styles.withdrawalsList}>
                {withdrawals.map((w) => (
                  <View key={w.id} style={styles.withdrawalRow}>
                    <Text style={styles.withdrawalAmount}>{formatAudCents(w.amountCents)}</Text>
                    <Text style={styles.withdrawalStatus}>{w.status}</Text>
                  </View>
                ))}
              </View>
            )}

            <Text style={styles.sectionTitle}>Transaction history</Text>
            {transactions.length === 0 && <Text style={styles.emptyText}>No transactions yet.</Text>}
          </View>
        }
        renderItem={({ item }) => (
          <Card style={styles.txCard}>
            <InfoRow label={TRANSACTION_LABELS[item.type]} value={`${item.amountCents >= 0 ? "+" : ""}${formatAudCents(item.amountCents)}`} emphasize={item.amountCents >= 0} />
            <Text style={styles.txDescription}>{item.description}</Text>
            <Text style={styles.txMeta}>
              {new Date(item.createdAt).toLocaleString("en-AU")} · Balance: {formatAudCents(item.balanceAfterCents)}
            </Text>
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.md },
  headerContent: { gap: spacing.md, marginBottom: spacing.sm },
  subtitle: { color: colors.muted, fontSize: 14 },
  balanceCard: { gap: spacing.xs, borderTopWidth: 4, borderTopColor: colors.brand },
  balanceLabel: { color: colors.muted, fontSize: 11, fontFamily: font.w700, letterSpacing: 1.4, textTransform: "uppercase" },
  balanceValue: { ...typography.display, fontSize: 56, lineHeight: 58, color: colors.foreground },
  sectionTitle: { ...typography.subheading, color: colors.foreground, marginTop: spacing.md },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  presetButton: { flexGrow: 1, minWidth: "45%" },
  customRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  customInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.foreground,
    backgroundColor: colors.surface,
  },
  customButton: { paddingHorizontal: spacing.lg },
  termsGate: { backgroundColor: colors.neutralSoft, borderWidth: 1, borderColor: colors.neutralBorder, borderRadius: 10, padding: spacing.md, gap: spacing.sm },
  termsGateText: { color: colors.foreground, fontSize: 13, lineHeight: 18, flex: 1 },
  addFundsLink: { color: colors.brandText, fontFamily: font.w700, textDecorationLine: "underline" },
  termsRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkboxChecked: { backgroundColor: colors.brand, borderColor: colors.brand },
  checkboxMark: { color: colors.onBrand, fontSize: 13, fontFamily: font.w800 },
  withdrawNote: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  withdrawalsList: { gap: spacing.xs, marginTop: spacing.xs },
  withdrawalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border },
  withdrawalAmount: { color: colors.foreground, fontSize: 13, fontFamily: font.w700 },
  withdrawalStatus: { color: colors.muted, fontSize: 12, textTransform: "capitalize" },
  successText: { color: colors.brandText, fontSize: 13, backgroundColor: colors.brandSoft, borderRadius: 10, padding: spacing.sm },
  errorText: { color: colors.foreground, fontSize: 13, backgroundColor: colors.neutralSoft, borderRadius: 10, padding: spacing.sm },
  emptyText: { color: colors.muted, fontSize: 14, textAlign: "center", paddingVertical: spacing.lg },
  txCard: { gap: spacing.xs },
  txDescription: { color: colors.foreground, fontSize: 13 },
  txMeta: { color: colors.muted2, fontSize: 11 },
});
