import { Pressable, StyleSheet, Text, View } from "react-native";
import { Countdown } from "./Countdown";
import { colors, font, spacing } from "../constants/theme";
import { formatAudCents } from "../lib/format";
import type { SPORTS } from "../constants/sports";
import type { CompetitionState } from "./StatusBadge";

interface FeaturedCompetitionCardProps {
  sport: (typeof SPORTS)[keyof typeof SPORTS];
  roundLabel: string;
  gamesCount: number;
  /** null when no competition row exists yet for this round. */
  state: CompetitionState | null;
  /** null/undefined when the entry fee isn't known yet — the "Entry" cell then reads "TBC" rather than guessing. */
  entryFeeCents?: number | null;
  prizePoolVisible: boolean;
  currentPrizePoolCents: number | null;
  /** Null when there's no known cutoff yet to count down to (e.g. fixtures not finalised). */
  buyInCutoffAt: Date | null;
  /** True when the authenticated user already has an entry in this round — only changes the CTA label for the open/not-yet-open state. */
  alreadyEntered?: boolean;
  onEnterPress: () => void;
  onCardPress: () => void;
}

/**
 * Option D "Scoreboard" featured round: red top rule, sport + round header, split-flap
 * countdown to the buy-in cutoff, prize pool / entry cells, and a full-width red CTA.
 * The prize pool shows only when the server says it is visible (after kickoff) — before
 * that the sport's reveal phrase is shown. No entrant counts or payout estimates.
 */
export function FeaturedCompetitionCard({
  sport,
  roundLabel,
  gamesCount,
  state,
  entryFeeCents,
  prizePoolVisible,
  currentPrizePoolCents,
  buyInCutoffAt,
  alreadyEntered = false,
  onEnterPress,
  onCardPress,
}: FeaturedCompetitionCardProps) {
  const isClosed = state === "closed";
  const isSettled = state === "settled";
  const ctaLabel = isSettled ? "View results" : isClosed ? "Entries closed" : alreadyEntered ? "View my entry" : "Make your picks";
  const ctaDisabled = isClosed;
  const pickRule = sport.pickLabel.replace(/\.$/, "");

  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${sport.fullName} ${roundLabel} details`} onPress={onCardPress}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>
            {sport.name} · {roundLabel}
          </Text>
          <Text style={styles.headerMeta}>
            {gamesCount} {gamesCount === 1 ? "GAME" : "GAMES"}
          </Text>
        </View>

        <View style={styles.body}>
          <Text style={styles.rule}>{pickRule}</Text>
          {isSettled ? (
            <Text style={styles.stateText}>Settled</Text>
          ) : isClosed ? (
            <Text style={styles.stateText}>Entries closed</Text>
          ) : buyInCutoffAt ? (
            <>
              <Text style={styles.eyebrow}>ENTRIES CLOSE IN</Text>
              <Countdown target={buyInCutoffAt} variant="flap" />
            </>
          ) : (
            <Text style={styles.stateText}>Close time TBC</Text>
          )}
        </View>

        <View style={styles.cells}>
          <View style={[styles.cell, styles.cellDivider]}>
            <Text style={styles.eyebrow}>PRIZE POOL</Text>
            {prizePoolVisible && currentPrizePoolCents !== null ? (
              <Text style={[styles.cellValue, styles.cellValueAccent]}>{formatAudCents(currentPrizePoolCents)}</Text>
            ) : (
              <Text style={styles.cellValue}>{sport.revealPhrase.replace(/^revealed /, "")}</Text>
            )}
          </View>
          <View style={styles.cell}>
            <Text style={styles.eyebrow}>ENTRY</Text>
            <Text style={styles.cellValue}>{typeof entryFeeCents === "number" ? `From ${formatAudCents(entryFeeCents)}` : "TBC"}</Text>
          </View>
        </View>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={ctaLabel}
        accessibilityState={{ disabled: ctaDisabled }}
        disabled={ctaDisabled}
        onPress={onEnterPress}
        style={({ pressed }) => [styles.cta, ctaDisabled && styles.ctaDisabled, pressed && !ctaDisabled && styles.ctaPressed]}
      >
        <Text style={styles.ctaText}>{ctaLabel} »</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderTopWidth: 4, borderTopColor: colors.brand },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.foreground, fontFamily: font.display, fontSize: 22, textTransform: "uppercase" },
  headerMeta: { color: colors.muted, fontFamily: font.w600, fontSize: 12, letterSpacing: 0.6 },
  body: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  rule: { color: colors.muted, fontFamily: font.w500, fontSize: 13 },
  eyebrow: { color: colors.muted, fontFamily: font.w700, fontSize: 11, letterSpacing: 1.4 },
  stateText: { color: colors.foreground, fontFamily: font.display, fontSize: 24, textTransform: "uppercase" },
  cells: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.border },
  cell: { flex: 1, paddingHorizontal: spacing.lg, paddingVertical: 10, gap: 2 },
  cellDivider: { borderRightWidth: 1, borderRightColor: colors.border },
  cellValue: { color: colors.foreground, fontFamily: font.display, fontSize: 19, textTransform: "uppercase" },
  cellValueAccent: { color: colors.brandText },
  cta: { backgroundColor: colors.brand, minHeight: 56, alignItems: "center", justifyContent: "center" },
  ctaDisabled: { backgroundColor: colors.surfaceRaised },
  ctaPressed: { backgroundColor: colors.brandStrong },
  ctaText: { color: colors.onBrand, fontFamily: font.display, fontSize: 22, textTransform: "uppercase", letterSpacing: 0.5 },
});
