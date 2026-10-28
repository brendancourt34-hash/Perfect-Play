import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, font } from "../constants/theme";
import { Icon, type IconName } from "./icons";

/**
 * Only two tones exist in the Phase 14 palette: brand (electric green, for a positive/
 * active state) and neutral (grey, for everything else — including "incorrect" /
 * "not perfect"). There is no red/danger color; a failed or negative state is instead
 * distinguished by its icon (an X), never by hue, per the black/white/green brand rule.
 */
type Tone = "neutral" | "brand";

const TONE_STYLES: Record<Tone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: colors.neutralSoft, fg: colors.muted, border: colors.neutralBorder },
  // Scoreboard look: positive states are a solid red block with white text.
  brand: { bg: colors.brand, fg: colors.onBrand, border: colors.brand },
};

export function Badge({ label, tone = "neutral", icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const t = TONE_STYLES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg, borderColor: t.border }]} accessibilityLabel={label}>
      {icon && <Icon name={icon} size={12} color={t.fg} />}
      <Text style={[styles.text, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

// --- Domain-specific badges, mirroring src/components/result-badge.tsx on the web ---

export type SelectionResult = "pending" | "correct" | "incorrect" | "void";
export type PerfectResult = "pending" | "perfect" | "not_perfect";
export type CompetitionState = "not_yet_open" | "open" | "closed" | "settled";
export type GameStatus = "scheduled" | "live" | "final" | "postponed" | "cancelled";

/**
 * Optional per-sport wording overrides — e.g. NBA says "HIT"/"MISS"/"WINNER"/"FAILED"
 * instead of NRL/AFL's "Correct"/"Incorrect"/"Perfect"/"Not Perfect". Purely cosmetic:
 * the underlying tri-state value and every business rule are identical regardless of
 * which words are shown. Omitting `labels` keeps the original NRL/AFL wording exactly as
 * it was — this is additive, not a redesign.
 */
export interface ResultLabelOverrides {
  correct?: string;
  incorrect?: string;
  perfect?: string;
  notPerfect?: string;
}

export function SelectionBadge({ result, labels }: { result: SelectionResult; labels?: ResultLabelOverrides }) {
  const map: Record<SelectionResult, { label: string; tone: Tone; icon: IconName }> = {
    pending: { label: "Pending", tone: "neutral", icon: "pending" },
    correct: { label: labels?.correct ?? "Correct", tone: "brand", icon: "checkCircle" },
    incorrect: { label: labels?.incorrect ?? "Incorrect", tone: "neutral", icon: "xCircle" },
    void: { label: "Voided", tone: "neutral", icon: "pending" },
  };
  return <Badge {...map[result]} />;
}

export function PerfectBadge({ result, labels }: { result: PerfectResult; labels?: ResultLabelOverrides }) {
  const map: Record<PerfectResult, { label: string; tone: Tone; icon: IconName }> = {
    pending: { label: "Pending", tone: "neutral", icon: "pending" },
    perfect: { label: labels?.perfect ?? "Perfect", tone: "brand", icon: "trophy" },
    not_perfect: { label: labels?.notPerfect ?? "Not Perfect", tone: "neutral", icon: "xCircle" },
  };
  return <Badge {...map[result]} />;
}

export function CompetitionStateBadge({ state }: { state: CompetitionState }) {
  const map: Record<CompetitionState, { label: string; tone: Tone; icon: IconName }> = {
    not_yet_open: { label: "Not yet open", tone: "neutral", icon: "pending" },
    open: { label: "Open", tone: "brand", icon: "checkCircle" },
    closed: { label: "Closed", tone: "neutral", icon: "xCircle" },
    settled: { label: "Settled", tone: "neutral", icon: "checkCircle" },
  };
  return <Badge {...map[state]} />;
}

export function GameStatusBadge({ status }: { status: GameStatus }) {
  const map: Record<GameStatus, { label: string; tone: Tone; icon: IconName }> = {
    scheduled: { label: "Upcoming", tone: "neutral", icon: "pending" },
    live: { label: "Live", tone: "brand", icon: "live" },
    final: { label: "Final", tone: "neutral", icon: "checkCircle" },
    postponed: { label: "Postponed", tone: "neutral", icon: "pending" },
    cancelled: { label: "Cancelled", tone: "neutral", icon: "xCircle" },
  };
  return <Badge {...map[status]} />;
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    alignSelf: "flex-start",
  },
  text: { fontSize: 14, fontFamily: font.display, textTransform: "uppercase", letterSpacing: 0.4 },
});
