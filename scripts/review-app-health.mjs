#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const result = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    fileURLToPath(new URL("./review-app-health.ts", import.meta.url)),
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);

if (result.error || result.signal) {
  console.error("APP_HEALTH_REVIEWER_START_FAILED");
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
