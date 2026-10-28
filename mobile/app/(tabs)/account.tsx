import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../lib/auth-context";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";
import { ScreenHeader } from "../../components/ScreenHeader";
import { Logo } from "../../components/Logo";
import { Screen } from "../../components/Screen";
import { colors, spacing } from "../../constants/theme";

/**
 * The "More" tab — account info plus everything that doesn't have its own bottom-nav
 * slot. Wallet balance/management moved to its own Wallet tab (Phase: home redesign), so
 * this screen no longer duplicates it.
 */
export default function AccountScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
    setLoggingOut(false);
  }

  return (
    <Screen style={styles.container}>
      <ScreenHeader title="More" />

      <Card style={styles.userCard}>
        <Logo size="sm" />
        <View style={styles.userInfo}>
          <Text style={styles.email}>{user?.email}</Text>
          {user?.name && <Text style={styles.name}>{user.name}</Text>}
        </View>
      </Card>

      <Button label="How it Works" variant="secondary" onPress={() => router.push("/how-it-works")} />
      <Button label="Terms & Conditions" variant="secondary" onPress={() => router.push("/terms")} />

      <Button label="Log out" variant="secondary" onPress={handleLogout} loading={loggingOut} style={styles.logoutButton} />

      <Text style={styles.footnote}>No points. No leaderboard. No fantasy scoring.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.lg, gap: spacing.lg },
  userCard: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  userInfo: { gap: 2 },
  email: { color: colors.foreground, fontSize: 16, fontWeight: "700" },
  name: { color: colors.muted, fontSize: 13 },
  logoutButton: { marginTop: spacing.sm },
  footnote: { color: colors.muted2, fontSize: 12, textAlign: "center", marginTop: "auto", marginBottom: spacing.xl },
});
