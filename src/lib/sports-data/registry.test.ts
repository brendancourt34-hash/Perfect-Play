import { afterEach, describe, expect, it, vi } from "vitest";
import { getNbaSportsDataProvider, getSportsDataProvider, SportsDataNotConfiguredError } from "./registry";
import { NotYetAvailableError } from "./providers/champion-data-provider";
import { NbaEspnProvider } from "./providers/nba-espn-provider";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getSportsDataProvider (the single place code asks which provider to sync from)", () => {
  it("throws SportsDataNotConfiguredError when unset (the default) — never silently falls back to mock data", () => {
    vi.stubEnv("SPORTS_DATA_PROVIDER", undefined as unknown as string);
    expect(() => getSportsDataProvider()).toThrow(SportsDataNotConfiguredError);
  });

  it("returns the lifecycle mock provider only when explicitly opted in", () => {
    vi.stubEnv("SPORTS_DATA_PROVIDER", "mock");
    const provider = getSportsDataProvider();
    expect(provider.name).toBe("mock-lifecycle");
  });

  it("selecting champion-data does not fake a live connection — construction itself fails since no credentials exist", () => {
    vi.stubEnv("SPORTS_DATA_PROVIDER", "champion-data");
    expect(() => getSportsDataProvider()).toThrow(NotYetAvailableError);
  });
});

describe("getNbaSportsDataProvider (Phase 22 — real, keyless, no commercial gate to wait on)", () => {
  it("defaults to the real live NBA ESPN provider, unlike NRL/AFL's default-off", () => {
    vi.stubEnv("NBA_SPORTS_DATA_PROVIDER", undefined as unknown as string);
    expect(getNbaSportsDataProvider()).toBeInstanceOf(NbaEspnProvider);
  });

  it("can still be overridden to the mock fixture for testing", () => {
    vi.stubEnv("NBA_SPORTS_DATA_PROVIDER", "mock");
    expect(getNbaSportsDataProvider().name).toBe("mock-lifecycle");
  });

  it("can be explicitly disabled", () => {
    vi.stubEnv("NBA_SPORTS_DATA_PROVIDER", "none");
    expect(() => getNbaSportsDataProvider()).toThrow(SportsDataNotConfiguredError);
  });
});
