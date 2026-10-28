import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors, radius, spacing, font } from "../constants/theme";

interface TextFieldProps extends TextInputProps {
  label: string;
}

/** Labeled text input used on the login/register screens. */
export function TextField({ label, style, ...props }: TextFieldProps) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={[styles.input, style]} placeholderTextColor={colors.muted2} accessibilityLabel={label} {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.muted, fontSize: 13, fontFamily: font.w600, marginBottom: spacing.xs, marginTop: spacing.md },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    color: colors.foreground,
    fontSize: 15,
  },
});
