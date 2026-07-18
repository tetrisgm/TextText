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
    // The suite runs 70+ files in parallel and a few tests spawn Node
    // subprocesses (e.g. the native-tool-contract parity check) or do heavy
    // setup. The 5s/10s defaults are too tight under that parallel load and
    // produce false timeout failures in the autobuild ship gate even though
    // every assertion passes in isolation. Give the suite generous headroom.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
