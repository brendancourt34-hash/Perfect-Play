import { describe, expect, it } from "vitest";
import { assertSafeLoadTestDatabase } from "./db-client";

const REAL_DB = "postgresql://user:pass@ep-real-app.us-east-1.aws.neon.tech/neondb";

describe("assertSafeLoadTestDatabase", () => {
  it("refuses to run when LOAD_TEST_DATABASE_URL is unset", () => {
    expect(() => assertSafeLoadTestDatabase(undefined, REAL_DB)).toThrow(/LOAD_TEST_DATABASE_URL is not set/);
  });

  it("refuses to run when LOAD_TEST_DATABASE_URL is an empty string", () => {
    expect(() => assertSafeLoadTestDatabase("", REAL_DB)).toThrow(/LOAD_TEST_DATABASE_URL is not set/);
  });

  it("refuses to run when LOAD_TEST_DATABASE_URL is identical to the real DATABASE_URL", () => {
    expect(() => assertSafeLoadTestDatabase(REAL_DB, REAL_DB)).toThrow(/identical to DATABASE_URL/);
  });

  it("refuses a URL whose host looks like production", () => {
    expect(() => assertSafeLoadTestDatabase("postgresql://user:pass@my-production-db.example.com/app", REAL_DB)).toThrow(/production/i);
  });

  it("refuses a URL whose database name looks like production", () => {
    expect(() => assertSafeLoadTestDatabase("postgresql://user:pass@localhost:5432/perfect_play_production", REAL_DB)).toThrow(/production/i);
  });

  it("refuses an invalid URL", () => {
    expect(() => assertSafeLoadTestDatabase("not-a-url", REAL_DB)).toThrow(/not a valid connection URL/);
  });

  it("accepts a local Postgres instance clearly distinct from the real DATABASE_URL", () => {
    expect(() => assertSafeLoadTestDatabase("postgresql://loadtest:loadtest@localhost:5433/perfect_play_loadtest", REAL_DB)).not.toThrow();
  });

  it("accepts a dedicated, differently-named Neon branch", () => {
    expect(() => assertSafeLoadTestDatabase("postgresql://user:pass@ep-loadtest-branch.us-east-1.aws.neon.tech/neondb", REAL_DB)).not.toThrow();
  });

  it("accepts a safe URL even when the real DATABASE_URL is unknown/unset", () => {
    expect(() => assertSafeLoadTestDatabase("postgresql://loadtest@localhost:5433/perfect_play_loadtest", undefined)).not.toThrow();
  });
});
