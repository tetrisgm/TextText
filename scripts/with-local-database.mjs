#!/usr/bin/env node
// Build locally without inheriting the production connection used by release
// migrations. Vercel retains its separately configured runtime environment.
import { readFileSync, lstatSync, realpathSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";

/**
 * @param {string} root
 * @param {Record<string, string | undefined>} inherited
 */
export function localBuildEnvironment(root, inherited = process.env) {
  const path = resolve(root, ".env.local");
  const archiveMode = inherited.TEXTTEXT_LOCAL_DATABASE_INHERITED === "1";
  if (archiveMode) {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || realpathSync(path) !== join(realpathSync(root), ".env.local")) {
      throw new Error("Private archive environment must be a regular local file.");
    }
  }
  const bytes = readFileSync(path);
  // A verified archive contains no copied environment secrets. Only its exact
  // empty file plus explicit opt-in can select an inherited loopback URL.
  // Normal and nonempty files retain precedence over inherited connections.
  const local = archiveMode && bytes.length === 0
    ? inherited.DATABASE_URL
    : parseEnv(bytes.toString("utf8")).DATABASE_URL;
  let hostname;
  try { hostname = new URL(local).hostname; } catch { /* Fail without exposing a connection string. */ }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
    throw new Error("Local builds require a local Postgres DATABASE_URL in .env.local.");
  }
  return { ...inherited, DATABASE_URL: local };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (!command) throw new Error("Usage: with-local-database.mjs <command> [arguments]");
    const result = spawnSync(command, args, {
      env: localBuildEnvironment(process.cwd()),
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Local build failed.");
    process.exitCode = 1;
  }
}
