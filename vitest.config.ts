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
    include: ["src/**/*.test.ts"],
    // A few tests spawn subprocesses or do heavy setup. The outer work-unit
    // runner owns the process-group wall-clock cap, while these limits identify
    // a stuck individual test without retrying the full paid release pipeline.
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
