import { Redirect, Stack } from "expo-router";
import { useAuth } from "../../lib/auth-context";
import { colors } from "../../constants/theme";

export default function AuthLayout() {
  const { user } = useAuth();
  if (user) return <Redirect href="/(tabs)" />;

  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
