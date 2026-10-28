import { logEvent } from "@/lib/monitoring/log";

/**
 * Minimal Expo push HTTP client — talks directly to Expo's push service
 * (https://exp.host/--/api/v2/push/send), Expo's own documented REST API, no SDK
 * dependency needed for sending (the `expo-server-sdk` npm package is a thin wrapper
 * around this exact endpoint; calling it directly avoids an extra dependency for one
 * fetch call). Chunks to Expo's documented maximum of 100 messages per request.
 *
 * Never throws back to its caller — every failure (network error, malformed response, a
 * per-message delivery error) is caught and logged; a push failure must never affect the
 * customer event/moment it was already persisted for (see src/lib/push/delivery.ts).
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_MESSAGES_PER_REQUEST = 100;

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface SendResult {
  /** Push tokens Expo reported as permanently invalid (e.g. DeviceNotRegistered) — the caller is responsible for removing these from push_tokens so delivery never retries them forever. */
  invalidTokens: string[];
  sentCount: number;
  failedCount: number;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Sends a batch of push messages, chunked to Expo's per-request limit. Returns which
 * tokens were reported permanently invalid so the caller can clean them up — never
 * retries an invalid token itself (see the module doc comment).
 */
export async function sendExpoPushNotifications(messages: readonly ExpoPushMessage[]): Promise<SendResult> {
  if (messages.length === 0) return { invalidTokens: [], sentCount: 0, failedCount: 0 };

  const invalidTokens: string[] = [];
  let sentCount = 0;
  let failedCount = 0;

  for (const batch of chunk(messages, MAX_MESSAGES_PER_REQUEST)) {
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "Accept-Encoding": "gzip, deflate" },
        body: JSON.stringify(batch),
      });

      if (!response.ok) {
        failedCount += batch.length;
        logEvent("push_send_failed", { batchSize: batch.length, httpStatus: response.status }, "error");
        continue;
      }

      const body = (await response.json()) as { data?: ExpoPushTicket[]; errors?: unknown[] };
      const tickets = body.data ?? [];
      tickets.forEach((ticket, i) => {
        if (ticket.status === "ok") {
          sentCount++;
          return;
        }
        failedCount++;
        const errorCode = ticket.details?.error;
        if (errorCode === "DeviceNotRegistered") {
          invalidTokens.push(batch[i].to);
          logEvent("push_token_invalid", { errorCode });
        } else {
          logEvent("push_send_failed", { errorCode: errorCode ?? "unknown", message: ticket.message }, "warn");
        }
      });
    } catch (error) {
      failedCount += batch.length;
      logEvent("push_send_failed", { batchSize: batch.length, message: error instanceof Error ? error.message : String(error) }, "error");
    }
  }

  if (sentCount > 0) logEvent("push_send_succeeded", { sentCount });
  return { invalidTokens, sentCount, failedCount };
}
