import { defineConfig } from "vitest/config";

/**
 * Deliberately narrow: only pure TypeScript logic (lib/format.ts and similar) is
 * unit-testable here without a full React Native test runtime (jest-expo). Screens and
 * components that import react-native/expo-router/expo-secure-store are exercised by the
 * `expo export` bundle-verification check instead — see docs/phase12-mobile-entry-flow.md
 * for what full component testing would require.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
