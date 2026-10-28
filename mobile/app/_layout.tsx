import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../lib/auth-context";
import { handleInitialPushNavigation, setupPushNotificationListeners } from "../lib/push-notifications";
import { LoadingState } from "../components/ScreenStates";
import { colors } from "../constants/theme";

function RootNavigator() {
  const { bootstrapping } = useAuth();

  // Wired once for the app's whole lifetime: a tapped notification (background) or the
  // app being cold-launched BY tapping one both route through the exact same expo-router
  // navigation every other screen uses — see lib/push-notifications.ts.
  useEffect(() => {
    const cleanup = setupPushNotificationListeners();
    handleInitialPushNavigation();
    return cleanup;
  }, []);

  // Only ever blocks the app on the very first cold-start session check — every
  // subsequent auth state change is handled by <Redirect> inside the (auth)/(tabs)
  // group layouts, not by unmounting the navigator.
  if (bootstrapping) return <LoadingState label="Loading Perfect Play…" />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="round" />
      <Stack.Screen name="entry" />
      <Stack.Screen
        name="terms"
        options={{
          headerShown: true,
          title: "Terms & Conditions",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShadowVisible: false,
        }}
      />
      <Stack.Screen
        name="how-it-works"
        options={{
          headerShown: true,
          title: "How Perfect Play Works",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShadowVisible: false,
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
