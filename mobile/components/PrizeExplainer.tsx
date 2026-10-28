import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../constants/theme";

/**
 * Small, subtle explanation of how the Perfect Play prize pool works — shown on Home so a
 * new user understands the core concept without opening "How It Works". Deliberately
 * has no prize amount, entry fee, or sport-specific data: the pool size is configurable
 * (competitions.prizeAmountCents) and this copy must stay correct regardless of its value.
 *
 * UI/copy only — the actual rollover/even-split math lives in src/lib/perfect2/prize.ts
 * (allocatePrizePool/settlePrizePool) and src/lib/data/competitions.ts
 * (pushRolloverToNextCompetitionIfExists). This component does not compute or fetch
 * anything, so it can't get out of sync with the real settlement logic — it's just static
 * text describing the same rule.
 */
export function PrizeExplainer() {
  return (
    <View style={styles.container}>
      <Text style={styles.body}>GO PERFECT. TAKE THE ENTIRE POOL.</Text>
      <Text style={styles.body}>If more than one entry goes PERFECT, the pool is split evenly.</Text>
      <Text style={styles.body}>No PERFECT entries? The pool rolls over to next round.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 4, paddingHorizontal: spacing.lg },
  body: { color: colors.muted2, fontSize: 12, lineHeight: 17, textAlign: "center" },
});
