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
    // The suite runs 70+ files and a few tests spawn Node subprocesses (e.g.
    // the native-tool-contract parity check) or do heavy setup. Under heavy
    // concurrent machine load (a parallel Codex build on another project, a
    // ship in flight) imports and hooks can run 10x+ slower, so even 30s
    // produced false timeout failures in the autobuild ship gate. Give very
    // generous headroom; the ship gate also serialises files and retries.
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
