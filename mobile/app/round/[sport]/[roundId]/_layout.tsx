import { Stack, useRouter } from "expo-router";
import { EntryDraftProvider } from "../../../../lib/entry-draft-context";
import { IconButton } from "../../../../components/IconButton";
import { colors } from "../../../../constants/theme";

/**
 * Explicit back chevron (not the platform-default header back button/label) so every
 * screen in this flow — including the player-selection screen — gets a consistent,
 * unmistakable, on-brand top-left back target. Wraps the same router.back() the native
 * back gesture already uses, so it never creates a second navigation system: pressing it
 * simply pops this screen, landing on whatever screen was actually pushed before it
 * (buy-in, round detail, or wherever the flow was entered from), and in-progress picks
 * (held in EntryDraftProvider, scoped to this whole nested stack) are untouched since
 * only this one screen unmounts.
 */
function HeaderBackButton() {
  const router = useRouter();
  return <IconButton name="back" accessibilityLabel="Back" onPress={() => router.back()} />;
}

/**
 * Scopes the in-progress pick state (EntryDraftProvider) to exactly one round's entry
 * flow — index (round detail) → enter (picks) → review → confirmation. Leaving this
 * segment (e.g. backing out to the sport tab) naturally discards the draft since the
 * provider unmounts with it; nothing about a half-finished entry is ever persisted
 * server-side until the user actually submits.
 */
export default function RoundFlowLayout() {
  return (
    <EntryDraftProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShadowVisible: false,
          headerBackTitle: "Back",
          headerLeft: () => <HeaderBackButton />,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: "" }} />
        <Stack.Screen name="buy-in" options={{ title: "Entry" }} />
        <Stack.Screen name="payment" options={{ title: "Payment" }} />
        <Stack.Screen name="enter" options={{ title: "Make Your Picks" }} />
        <Stack.Screen name="review" options={{ title: "Review Entry" }} />
        <Stack.Screen
          name="confirmation"
          options={{ title: "Entry Submitted", headerBackVisible: false, gestureEnabled: false, headerLeft: () => null }}
        />
        <Stack.Screen name="results" options={{ title: "Results" }} />
      </Stack>
    </EntryDraftProvider>
  );
}
