import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { colors, minTouchTarget, radius, spacing, font } from "../constants/theme";

interface ButtonProps extends Omit<PressableProps, "style"> {
  label: string;
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({ label, variant = "primary", loading, disabled, style, ...props }: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        variant === "primary" && styles.primary,
        variant === "secondary" && styles.secondary,
        variant === "ghost" && styles.ghost,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? colors.onBrand : colors.brandText} />
      ) : (
        <Text
          style={[
            styles.label,
            variant === "primary" && styles.labelPrimary,
            variant === "secondary" && styles.labelSecondary,
            variant === "ghost" && styles.labelGhost,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: minTouchTarget + 10,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    flexDirection: "row",
  },
  primary: { backgroundColor: colors.brand },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
  ghost: { backgroundColor: "transparent" },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
  label: { fontSize: 20, fontFamily: font.display, letterSpacing: 0.5, textTransform: "uppercase" },
  labelPrimary: { color: colors.onBrand },
  labelSecondary: { color: colors.foreground },
  labelGhost: { color: colors.brandText },
});
