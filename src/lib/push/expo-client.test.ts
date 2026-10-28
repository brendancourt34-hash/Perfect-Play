import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendExpoPushNotifications, type ExpoPushMessage } from "./expo-client";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

const sampleMessage: ExpoPushMessage = { to: "ExponentPushToken[abc123]", title: "T", body: "B", data: { type: "perfect" } };

describe("sendExpoPushNotifications", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns immediately with no fetch call for an empty message list", async () => {
    const result = await sendExpoPushNotifications([]);
    expect(result).toEqual({ invalidTokens: [], sentCount: 0, failedCount: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a successful ticket as a counted success, no invalid tokens", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ status: "ok", id: "receipt-1" }] }));
    const result = await sendExpoPushNotifications([sampleMessage]);
    expect(result).toEqual({ invalidTokens: [], sentCount: 1, failedCount: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://exp.host/--/api/v2/push/send");
  });

  it("collects a DeviceNotRegistered token as invalid, without throwing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] }));
    const result = await sendExpoPushNotifications([sampleMessage]);
    expect(result.invalidTokens).toEqual([sampleMessage.to]);
    expect(result.failedCount).toBe(1);
    expect(result.sentCount).toBe(0);
  });

  it("counts a non-DeviceNotRegistered error as failed but not invalid", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ status: "error", details: { error: "MessageTooBig" } }] }));
    const result = await sendExpoPushNotifications([sampleMessage]);
    expect(result.invalidTokens).toEqual([]);
    expect(result.failedCount).toBe(1);
  });

  it("never throws on a non-ok HTTP response — counts the whole batch as failed", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 500));
    await expect(sendExpoPushNotifications([sampleMessage])).resolves.toEqual({ invalidTokens: [], sentCount: 0, failedCount: 1 });
  });

  it("never throws when fetch itself rejects (network failure)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(sendExpoPushNotifications([sampleMessage])).resolves.toEqual({ invalidTokens: [], sentCount: 0, failedCount: 1 });
  });

  it("chunks more than 100 messages into multiple requests, each within Expo's documented limit", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: Array.from({ length: 100 }, () => ({ status: "ok" })) }));
    const messages = Array.from({ length: 150 }, (_, i) => ({ ...sampleMessage, to: `ExponentPushToken[${i}]` }));
    await sendExpoPushNotifications(messages);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBatch = JSON.parse(fetchMock.mock.calls[0][1].body);
    const secondBatch = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(firstBatch.length).toBe(100);
    expect(secondBatch.length).toBe(50);
  });
});
