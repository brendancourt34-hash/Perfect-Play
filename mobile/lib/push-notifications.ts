import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";
import * as api from "./api";

/**
 * Real Expo push notifications — connects to the existing server-side event system
 * (POST/DELETE /api/me/push-tokens, already built) without inventing a second one. This
 * module owns exactly three things: requesting permission + obtaining the device's Expo
 * push token, telling the server about it, and routing a tapped notification to the right
 * screen using the SAME navigation the rest of the app already uses (expo-router).
 *
 * SDK 57 note (see mobile/AGENTS.md — always check the exact versioned docs before
 * touching this): remote push delivery via expo-notifications is unavailable in Expo Go
 * on Android from SDK 53 onward — a development build is required there. iOS remote push
 * has required a development/production build (not Expo Go) since SDK 49. Local
 * notifications and the permission/registration flow itself still work in Expo Go on iOS.
 */

const PUSH_TOKEN_KEY = "perfect2_push_token";

/** Foreground behaviour: Perfect Play Moments are already visible in-app the instant they're fetched (the Moments feed is the source of truth) — showing a banner/alert on top of a screen the user is already looking at would just be a duplicate. Still update the badge/log quietly. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: false,
    shouldShowList: true,
  }),
});

async function getStoredPushToken(): Promise<string | null> {
  return SecureStore.getItemAsync(PUSH_TOKEN_KEY);
}

/**
 * Requests permission (if not already determined) and registers this device's Expo push
 * token with the server. Safe to call on every authenticated app start — it never asks
 * for permission again once the user has already answered (grant OR deny), and re-sending
 * an unchanged token to the server is a cheap, idempotent no-op. Never blocks/throws: a
 * denied permission, a simulator with no push capability, or a missing EAS project ID all
 * resolve to `null` quietly rather than breaking app startup.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  try {
    if (!Device.isDevice) {
      console.log("[push] Skipping push registration — physical device required (simulators/emulators cannot receive real push tokens).");
      return null;
    }

    const existing = await Notifications.getPermissionsAsync();
    let finalStatus = existing.status;
    if (existing.status !== "granted") {
      // Ask only if the user hasn't already answered — never re-prompt someone who
      // already said no, matching the platform's own one-shot permission convention.
      const requested = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
      finalStatus = requested.status;
    }
    if (finalStatus !== "granted") {
      console.log("[push] Notification permission not granted — Perfect Play Moments remain fully available in-app regardless.");
      return null;
    }

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", { name: "default", importance: Notifications.AndroidImportance.DEFAULT });
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      console.log("[push] No EAS projectId configured — cannot obtain a real Expo push token yet. Set up an EAS project (`eas init`) to enable push.");
      return null;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    const platform: api.PushPlatform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
    const result = await api.registerPushToken(token, platform);
    if (result.ok) {
      await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token);
    } else {
      console.log("[push] Server rejected push token registration:", result.message);
    }
    return token;
  } catch (error) {
    // Never let a push-registration failure block app usage — the Moments feed already
    // works independently of push.
    console.log("[push] Registration failed (non-fatal):", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** Called on logout — removes this device's token from the signed-out user's account so it never receives another user's future pushes. Does not touch OS-level permission (that stays granted for whoever signs in next). */
export async function unregisterPushNotificationsAsync(): Promise<void> {
  const token = await getStoredPushToken();
  if (!token) return;
  try {
    await api.removePushToken(token);
  } catch {
    // Best-effort — the device will simply re-register on next login regardless.
  } finally {
    await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
  }
}

/** The deep-link payload every push message carries — mirrors src/lib/push/messages.ts's PushContent.data on the server exactly; changing one without the other breaks navigation. */
interface PushNavigationData {
  screen?: "round-entry" | "my-entries" | "results";
  sportCode?: string;
  roundId?: number;
}

function navigateForPush(data: PushNavigationData | undefined): void {
  if (!data?.screen) return;
  switch (data.screen) {
    case "round-entry":
      if (data.sportCode && data.roundId) router.push(`/round/${data.sportCode}/${data.roundId}`);
      break;
    case "results":
      if (data.sportCode && data.roundId) router.push(`/round/${data.sportCode}/${data.roundId}/results`);
      break;
    case "my-entries":
    default:
      router.push("/(tabs)/my-entries");
      break;
  }
}

/**
 * Wires up the two notification listeners expo-notifications provides — call once near
 * the app root (see app/_layout.tsx). Returns a cleanup function for the effect that
 * installed it. Tapping a notification (background OR the app being launched fresh from
 * one) routes into the app using the exact same expo-router navigation every other screen
 * uses — never a bespoke second navigation mechanism.
 */
export function setupPushNotificationListeners(): () => void {
  const receivedSub = Notifications.addNotificationReceivedListener(() => {
    // Foreground receipt — intentionally a no-op beyond the OS-level handling above.
    // Whatever screen the user navigates to next will read the live Moments feed, which
    // already reflects this event; there is nothing additional to do here.
  });

  const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as PushNavigationData | undefined;
    navigateForPush(data);
  });

  return () => {
    receivedSub.remove();
    responseSub.remove();
  };
}

/** Checks whether a notification launched the app from a fully-quit state (cold start) and, if so, navigates once the navigator is ready. Call once from the root layout, after the first render. */
export async function handleInitialPushNavigation(): Promise<void> {
  const response = await Notifications.getLastNotificationResponseAsync();
  if (!response) return;
  const data = response.notification.request.content.data as PushNavigationData | undefined;
  navigateForPush(data);
}
