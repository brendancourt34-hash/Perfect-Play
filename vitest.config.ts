import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // The Expo app in mobile/ is a separate package with its own vitest config/test
    // runner (mobile/vitest.config.ts) — never picked up by the root suite.
    exclude: ["**/node_modules/**", "mobile/**"],
  },
});
