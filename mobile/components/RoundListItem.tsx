import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card } from "./Card";
import { CompetitionStateBadge, type CompetitionState } from "./StatusBadge";
import { Pill } from "./Pill";
import { Icon } from "./icons";
import { DateChip } from "./DateChip";
import { colors, spacing, typography } from "../constants/theme";

interface RoundListItemProps {
  title: string;
  /** null when no competition row exists yet for this round (nothing has opened it). */
  state: CompetitionState | null;
  dateLine: string;
  feeLine?: string | null;
  /** True once the current user already has an entry in this round's competition. */
  alreadyEntered?: boolean;
  /** When provided, replaces the plain dateLine text with the reference's bordered day/month chip (Home's "Upcoming Competitions" row) — omitted, the row keeps its original text-only date (the Competitions tab's sport list). */
  dateChip?: Date | null;
  onPress: () => void;
}

/** One row in the NRL/AFL round list. */
export function RoundListItem({ title, state, dateLine, feeLine, alreadyEntered, dateChip, onPress }: RoundListItemProps) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}>
      <Card style={styles.card}>
        <View style={styles.main}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{title}</Text>
            <View style={styles.badges}>
              {alreadyEntered && <Pill label="Entered" tone="brand" />}
              {state && <CompetitionStateBadge state={state} />}
            </View>
          </View>
          {feeLine && <Text style={styles.feeLine}>{feeLine}</Text>}
          {!dateChip && <Text style={styles.dateLine}>{dateLine}</Text>}
        </View>
        {dateChip ? <DateChip date={dateChip} /> : <Icon name="chevronRight" size={18} color={colors.muted2} />}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  main: { flex: 1, gap: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  badges: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  title: { ...typography.subheading, color: colors.foreground, flexShrink: 1 },
  feeLine: { color: colors.muted, fontSize: 12 },
  dateLine: { color: colors.muted2, fontSize: 12 },
});
