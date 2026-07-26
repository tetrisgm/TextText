#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required to align the Vercel runtime.");
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(databaseUrl);
} catch {
  console.error("DATABASE_URL is not a valid URL.");
  process.exit(1);
}

if (!parsed.hostname.endsWith(".neon.tech")) {
  console.error("Refusing to configure a non-Neon production database.");
  process.exit(1);
}

const result = spawnSync(
  "npx",
  ["vercel", "env", "update", "DATABASE_URL", "production", "--yes"],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CI: "1",
      VERCEL_TELEMETRY_DISABLED: "1",
    },
    input: databaseUrl,
    stdio: ["pipe", "inherit", "inherit"],
  },
);

if (result.error) {
  console.error(`Could not update the Vercel runtime: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
