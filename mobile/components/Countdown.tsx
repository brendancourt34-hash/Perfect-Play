import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "../constants/theme";

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

interface CountdownProps {
  target: Date;
  label?: string;
  /** "boxed" (default) = the HRS/MINS/SECS segment row. "compact" = a single "2D 14H 32M"-style line, day-aware — used by FeaturedCompetitionCard's reference layout. */
  variant?: "boxed" | "compact";
  /** compact variant only — label shown above the value, e.g. "Starts In". */
  compactLabel?: string;
}

/** Purely presentational — ticks locally from `target`, never treats the client clock as authoritative for anything server-decided (cutoff enforcement stays server-side). */
export function Countdown({ target, label = "Locks in", variant = "boxed", compactLabel = "Starts In" }: CountdownProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remainingMs = Math.max(0, target.getTime() - now);
  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (variant === "compact") {
    return (
      <View>
        <Text style={styles.compactLabel}>{remainingMs === 0 ? "Status" : compactLabel}</Text>
        <Text style={styles.compactValue}>{remainingMs === 0 ? "Live" : formatCompact(days, hours, minutes)}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{remainingMs === 0 ? "Locked" : label}</Text>
      {remainingMs > 0 && (
        <View style={styles.row}>
          <Segment value={pad(hours)} unit="HRS" />
          <Text style={styles.colon}>:</Text>
          <Segment value={pad(minutes)} unit="MINS" />
          <Text style={styles.colon}>:</Text>
          <Segment value={pad(seconds)} unit="SECS" />
        </View>
      )}
    </View>
  );
}

/** "2D 14H 32M" — drops leading zero-value units (e.g. "14H 32M" once under a day, "32M" once under an hour), never shows seconds (this format is for a glanceable card, not a precise timer). */
function formatCompact(days: number, hours: number, minutes: number): string {
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}D`);
  if (days > 0 || hours > 0) parts.push(`${hours}H`);
  parts.push(`${minutes}M`);
  return parts.join(" ");
}

function Segment({ value, unit }: { value: string; unit: string }) {
  return (
    <View style={styles.segment}>
      <Text style={styles.segmentValue}>{value}</Text>
      <Text style={styles.segmentUnit}>{unit}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", backgroundColor: colors.surfaceRaised, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  label: { ...typography.label, color: colors.muted2, textTransform: "uppercase", marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
  segment: { alignItems: "center", minWidth: 30 },
  segmentValue: { color: colors.foreground, fontSize: 18, fontWeight: "800", fontVariant: ["tabular-nums"] },
  segmentUnit: { color: colors.muted2, fontSize: 9, fontWeight: "700" },
  colon: { color: colors.muted2, fontSize: 16, fontWeight: "800", marginBottom: 8 },
  compactLabel: { color: colors.muted, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 },
  compactValue: { color: colors.brand, fontSize: 18, fontWeight: "800", marginTop: 2, fontVariant: ["tabular-nums"] },
});
