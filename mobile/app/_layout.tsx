import { useEffect } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import {
  Saira_400Regular,
  Saira_500Medium,
  Saira_600SemiBold,
  Saira_700Bold,
  Saira_800ExtraBold,
} from "@expo-google-fonts/saira";
import { SairaCondensed_700Bold, SairaCondensed_800ExtraBold } from "@expo-google-fonts/saira-condensed";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../lib/auth-context";
import { handleInitialPushNavigation, setupPushNotificationListeners } from "../lib/push-notifications";
import { LoadingState } from "../components/ScreenStates";
import { colors, font } from "../constants/theme";

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
          headerTitleStyle: { fontFamily: font.display, fontSize: 20 },
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
          headerTitleStyle: { fontFamily: font.display, fontSize: 20 },
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Saira_400Regular,
    Saira_500Medium,
    Saira_600SemiBold,
    Saira_700Bold,
    Saira_800ExtraBold,
    SairaCondensed_700Bold,
    SairaCondensed_800ExtraBold,
  });
  // Render nothing for the few ms the bundled fonts take to register; on a load error we
  // fall through and the system font is used rather than blocking the app.
  if (!fontsLoaded && !fontError) return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
