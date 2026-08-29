import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // {ts,tsx} because it was ts alone, and a .tsx test file committed on
    // 2026-08-19 with three tests in it had never once run. A test that cannot
    // fail is worse than no test: it reads as coverage.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // A few tests spawn subprocesses or do heavy setup. The outer work-unit
    // runner owns the process-group wall-clock cap, while these limits identify
    // a stuck individual test without retrying the full paid release pipeline.
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
