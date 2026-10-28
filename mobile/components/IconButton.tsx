import { Pressable, StyleSheet, type PressableProps } from "react-native";
import { colors, minTouchTarget, radius } from "../constants/theme";
import { Icon, type IconName } from "./icons";

interface IconButtonProps extends Omit<PressableProps, "style"> {
  name: IconName;
  accessibilityLabel: string;
  size?: number;
  variant?: "plain" | "filled";
}

/** Circular icon-only tap target — back buttons, close buttons, header actions. */
export function IconButton({ name, accessibilityLabel, size = 20, variant = "plain", ...props }: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [styles.base, variant === "filled" && styles.filled, pressed && styles.pressed]}
      {...props}
    >
      <Icon name={name} size={size} color={colors.foreground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  filled: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  pressed: { opacity: 0.6 },
});
