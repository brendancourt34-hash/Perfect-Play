import { StyleSheet, type ViewProps } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { colors } from "../constants/theme";

interface ScreenProps extends ViewProps {
  edges?: readonly Edge[];
}

/**
 * Safe-area-aware root for every top-level screen. Every navigator in this app sets
 * headerShown: false (screens render their own title/branding), so there is no native
 * header to automatically inset content below the status bar / notch / Dynamic Island —
 * without this, a screen's own title text renders underneath it. Only the top edge is
 * inset by default: tab screens already get correct bottom spacing from the tab bar
 * itself, and stack screens' own footers use ordinary padding, so applying "bottom" too
 * would double up spacing rather than fix anything.
 */
export function Screen({ edges = ["top"], style, ...props }: ScreenProps) {
  return <SafeAreaView edges={edges} style={[styles.flex, style]} {...props} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
});
