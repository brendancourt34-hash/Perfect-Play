import { StyleSheet, Text, View } from "react-native";
import { Card } from "./Card";
import { GameStatusBadge, type GameStatus } from "./StatusBadge";
import { colors, spacing, font } from "../constants/theme";

interface GameCardProps {
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number | null;
  awayScore: number | null;
  kickoffLine: string;
  status: GameStatus;
}

/** A single game's score/status card, used on the round-detail screen. */
export function GameCard({ homeTeamName, awayTeamName, homeScore, awayScore, kickoffLine, status }: GameCardProps) {
  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.teamName}>{homeTeamName}</Text>
        {homeScore !== null && <Text style={styles.score}>{homeScore}</Text>}
      </View>
      <View style={styles.row}>
        <Text style={styles.teamName}>{awayTeamName}</Text>
        {awayScore !== null && <Text style={styles.score}>{awayScore}</Text>}
      </View>
      <View style={styles.footer}>
        <Text style={styles.kickoff}>{kickoffLine}</Text>
        <GameStatusBadge status={status} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  teamName: { color: colors.foreground, fontSize: 19, fontFamily: font.display, textTransform: "uppercase" },
  score: { color: colors.foreground, fontSize: 20, fontFamily: font.display, fontVariant: ["tabular-nums"] },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  kickoff: { color: colors.muted2, fontSize: 12 },
});
