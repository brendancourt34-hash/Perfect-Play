import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Link } from "expo-router";
import { useAuth } from "../../lib/auth-context";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import { Logo } from "../../components/Logo";
import { Screen } from "../../components/Screen";
import { colors, spacing, font } from "../../constants/theme";

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setLoading(true);
    const result = await login(email.trim(), password);
    setLoading(false);
    if (!result.ok) setError(result.errors?.[0] ?? result.message);
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <Logo size="lg" withCaption />
          </View>
          <Text style={styles.subtitle}>Sign in to pick your teams.</Text>

          <View style={styles.form}>
            <TextField
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              placeholder="you@example.com"
            />

            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              placeholder="••••••••"
            />

            {error && <Text style={styles.error}>{error}</Text>}

            <Button label="Log in" onPress={handleSubmit} loading={loading} style={{ marginTop: spacing.md }} />

            <Link href="/(auth)/register" style={styles.link}>
              <Text style={styles.linkText}>Don&apos;t have an account? Create one</Text>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: "center", padding: spacing.xl },
  brand: { alignItems: "center", marginBottom: spacing.md },
  subtitle: { color: colors.muted, textAlign: "center", marginTop: spacing.sm, marginBottom: spacing.xxl, fontSize: 15 },
  form: { gap: spacing.xs },
  error: { color: colors.foreground, fontSize: 13, marginTop: spacing.md },
  link: { marginTop: spacing.lg, alignSelf: "center" },
  linkText: { color: colors.brandText, fontSize: 14, fontFamily: font.w600 },
});
