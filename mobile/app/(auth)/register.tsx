import { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Link, useRouter } from "expo-router";
import * as api from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import { Screen } from "../../components/Screen";
import { colors, spacing, typography } from "../../constants/theme";

export default function RegisterScreen() {
  const { register } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [termsVersionId, setTermsVersionId] = useState<number | null>(null);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const loadTerms = useCallback(async () => {
    const result = await api.getTerms();
    if (result.ok) setTermsVersionId(result.data.terms.id);
  }, []);

  useEffect(() => {
    loadTerms();
  }, [loadTerms]);

  async function handleSubmit() {
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (!agreedToTerms) {
      setError("You must agree to the Perfect Play Terms & Conditions and Privacy Policy to continue.");
      return;
    }
    setLoading(true);
    const result = await register(email.trim(), password, name.trim());
    if (result.ok && termsVersionId !== null) {
      await api.acceptTerms(termsVersionId);
    }
    setLoading(false);
    if (!result.ok) setError(result.errors?.[0] ?? result.message);
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.subtitle}>Pick the Perfect Round. Get every pick right. Go PERFECT.</Text>

          <View style={styles.form}>
            <TextField label="Name" value={name} onChangeText={setName} textContentType="name" placeholder="Your name" />

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
              textContentType="newPassword"
              placeholder="At least 8 characters"
            />

            <Pressable style={styles.termsRow} onPress={() => setAgreedToTerms((prev) => !prev)} accessibilityRole="checkbox" accessibilityState={{ checked: agreedToTerms }}>
              <View style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}>{agreedToTerms && <Text style={styles.checkboxMark}>✓</Text>}</View>
              <Text style={styles.termsText}>
                I have read and agree to the Perfect Play{" "}
                <Text style={styles.termsLink} onPress={() => router.push("/terms")}>
                  Terms & Conditions
                </Text>{" "}
                and Privacy Policy
              </Text>
            </Pressable>

            {error && <Text style={styles.error}>{error}</Text>}

            <Button label="Create account" onPress={handleSubmit} loading={loading} style={{ marginTop: spacing.md }} />

            <Link href="/(auth)/login" style={styles.link}>
              <Text style={styles.linkText}>Already have an account? Log in</Text>
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
  termsRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginTop: spacing.md },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkboxChecked: { backgroundColor: colors.brand, borderColor: colors.brand },
  checkboxMark: { color: colors.onBrand, fontSize: 13, fontWeight: "800" },
  termsText: { flex: 1, color: colors.muted, fontSize: 13, lineHeight: 18 },
  termsLink: { color: colors.brand, fontWeight: "700", textDecorationLine: "underline" },
  title: { ...typography.title, fontSize: 24, color: colors.foreground, textAlign: "center" },
  subtitle: { color: colors.muted, textAlign: "center", marginTop: spacing.sm, marginBottom: spacing.xxl },
  form: { gap: spacing.xs },
  error: { color: colors.foreground, fontSize: 13, marginTop: spacing.md },
  link: { marginTop: spacing.lg, alignSelf: "center" },
  linkText: { color: colors.brand, fontSize: 14, fontWeight: "600" },
});
