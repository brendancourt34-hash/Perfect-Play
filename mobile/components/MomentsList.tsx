import { StyleSheet, Text, View } from "react-native";
import { Card } from "./Card";
import { Icon } from "./icons";
import { colors, spacing, typography } from "../constants/theme";
import type { PerfectPlayMoment } from "../lib/api";

/**
 * Perfect Play Moments feed — reused wherever a customer's progression story belongs
 * (currently the entry detail screen). Pure display: the screen fetches
 * api.listMoments()/markMomentsRead() and passes the result in, no fetching here. Renders
 * nothing when there are no moments yet, rather than an empty placeholder card — a round
 * with no moments yet is a normal, common state, not an error.
 */
export function MomentsList({ moments }: { moments: PerfectPlayMoment[] }) {
  if (moments.length === 0) return null;

  return (
    <View style={styles.list}>
      {moments.map((moment) => (
        <Card key={moment.id} style={styles.card}>
          <Icon name="bell" size={16} color={colors.brand} />
          <Text style={styles.message}>{moment.message}</Text>
          {!moment.readAt && <View style={styles.unreadDot} accessibilityLabel="Unread" />}
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
  message: { ...typography.bodyStrong, color: colors.foreground, fontSize: 13, flex: 1 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand },
});
