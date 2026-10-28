import { afterEach, describe, expect, it, vi } from "vitest";
import { getSportsDataConfig } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getSportsDataConfig (defaults to no real connection)", () => {
  it("defaults to \"none\" when SPORTS_DATA_PROVIDER is unset", () => {
    vi.stubEnv("SPORTS_DATA_PROVIDER", undefined as unknown as string);
    expect(getSportsDataConfig().provider).toBe("none");
  });

  it("falls back to \"none\" for any unrecognized value rather than passing it through", () => {
    vi.stubEnv("SPORTS_DATA_PROVIDER", "stats-perform");
    expect(getSportsDataConfig().provider).toBe("none");
  });

  it("accepts \"mock\"", () => {
    vi.stubEnv("SPORTS_DATA_PROVIDER", "mock");
    expect(getSportsDataConfig().provider).toBe("mock");
  });

  it("accepts \"champion-data\"", () => {
    vi.stubEnv("SPORTS_DATA_PROVIDER", "champion-data");
    expect(getSportsDataConfig().provider).toBe("champion-data");
  });
});
