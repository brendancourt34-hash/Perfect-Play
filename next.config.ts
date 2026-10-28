import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */

  // Only set when running an isolated load-test app server (scripts/loadtest/run.ts's
  // "settlement" scenario against LOAD_TEST_DATABASE_URL) alongside the normal dev
  // server — Next.js refuses to run two `next dev` processes sharing one project
  // directory's .next folder, so the isolated server gets its own build directory here.
  // Unset (the default, every normal dev/build) behaves exactly as before.
  ...(process.env.LOAD_TEST_ISOLATED_DIST_DIR ? { distDir: process.env.LOAD_TEST_ISOLATED_DIST_DIR } : {}),
};

export default nextConfig;
