import { Redirect, Tabs } from "expo-router";
import { useAuth } from "../../lib/auth-context";
import { Icon, type IconName } from "../../components/icons";
import { colors } from "../../constants/theme";

function TabIcon({ name, focused }: { name: IconName; focused: boolean }) {
  return <Icon name={name} size={24} color={focused ? colors.brand : colors.muted} />;
}

export default function TabsLayout() {
  const { user } = useAuth();
  if (!user) return <Redirect href="/(auth)/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.foreground,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, paddingTop: 8 },
        // Kept deliberately small (not the ~13pt measured off the reference): "Competitions"
        // is the longest label across 5 tabs, and a bolder/bigger label was truncating it
        // to "Competiti…" — avoiding that takes priority over matching the measured size.
        tabBarLabelStyle: { fontSize: 10, fontWeight: "700" },
        tabBarItemStyle: { paddingHorizontal: 0 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} /> }} />
      <Tabs.Screen
        name="competitions"
        options={{ title: "Competitions", tabBarIcon: ({ focused }) => <TabIcon name="trophy" focused={focused} /> }}
      />
      <Tabs.Screen
        name="my-entries"
        options={{ title: "My Entries", tabBarIcon: ({ focused }) => <TabIcon name="ticket" focused={focused} /> }}
      />
      <Tabs.Screen
        name="wallet"
        options={{ title: "Wallet", tabBarIcon: ({ focused }) => <TabIcon name="wallet" focused={focused} /> }}
      />
      <Tabs.Screen
        name="account"
        options={{ title: "More", tabBarIcon: ({ focused }) => <TabIcon name="more" focused={focused} /> }}
      />
      {/* NRL/AFL/NBA/NFL stay reachable from the Home screen's sport cards and the
          Competitions tab's sport switcher but are no longer bottom-nav destinations —
          href: null keeps the route registered without a tab. */}
      <Tabs.Screen name="nrl" options={{ href: null }} />
      <Tabs.Screen name="afl" options={{ href: null }} />
      <Tabs.Screen name="nba" options={{ href: null }} />
      <Tabs.Screen name="nfl" options={{ href: null }} />
    </Tabs>
  );
}
