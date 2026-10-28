import { Redirect, Tabs } from "expo-router";
import { View } from "react-native";
import { useAuth } from "../../lib/auth-context";
import { colors, font } from "../../constants/theme";

/**
 * Option D "Scoreboard" tab bar: text-only condensed labels with a red rule above the
 * active tab (drawn in the icon slot so it sits at the top of the item).
 */
function ActiveRule({ focused }: { focused: boolean }) {
  return <View style={{ width: 44, height: 3, backgroundColor: focused ? colors.brand : "transparent", marginBottom: 4 }} />;
}

export default function TabsLayout() {
  const { user } = useAuth();
  if (!user) return <Redirect href="/(auth)/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.foreground,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border, paddingTop: 0 },
        tabBarLabelStyle: { fontSize: 15, fontFamily: font.display, letterSpacing: 0.8, textTransform: "uppercase" },
        tabBarItemStyle: { paddingHorizontal: 0 },
        tabBarIconStyle: { height: 10 },
        tabBarIcon: ({ focused }) => <ActiveRule focused={focused} />,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="competitions" options={{ title: "Play" }} />
      <Tabs.Screen name="my-entries" options={{ title: "Entries" }} />
      <Tabs.Screen name="wallet" options={{ title: "Wallet" }} />
      <Tabs.Screen name="account" options={{ title: "Account" }} />
      {/* NRL/AFL/NBA/NFL stay reachable from Home's sport tiles and the Play tab's sport
          switcher but are not bottom-nav destinations — href: null keeps the route. */}
      <Tabs.Screen name="nrl" options={{ href: null }} />
      <Tabs.Screen name="afl" options={{ href: null }} />
      <Tabs.Screen name="nba" options={{ href: null }} />
      <Tabs.Screen name="nfl" options={{ href: null }} />
    </Tabs>
  );
}
