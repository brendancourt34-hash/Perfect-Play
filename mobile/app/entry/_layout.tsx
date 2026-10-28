import { Stack } from "expo-router";
import { colors } from "../../constants/theme";

export default function EntryLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="[entryId]" options={{ title: "My Entry" }} />
    </Stack>
  );
}
