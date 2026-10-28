import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { colors, minTouchTarget, radius, spacing } from "../constants/theme";
import { Icon } from "./icons";

export function SearchInput(props: TextInputProps) {
  return (
    <View style={styles.container}>
      <Icon name="search" size={16} color={colors.muted2} />
      <TextInput style={styles.input} placeholderTextColor={colors.muted2} autoCorrect={false} {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: minTouchTarget,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  input: { flex: 1, color: colors.foreground, fontSize: 15, minHeight: minTouchTarget },
});
