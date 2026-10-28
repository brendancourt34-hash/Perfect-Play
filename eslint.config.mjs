import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The isolated settlement load test's own Next build directory (see
    // next.config.ts's LOAD_TEST_ISOLATED_DIST_DIR / scripts/loadtest/README.md) — a
    // generated build artifact exactly like .next/, never source to lint.
    ".next-loadtest/**",
    // The Expo mobile app is a separate package with its own tooling/lint setup.
    "mobile/**",
  ]),
]);

export default eslintConfig;
