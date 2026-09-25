#!/usr/bin/env node
import { lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { isEntrypoint } from "./entrypoint.mjs";

export function protectedEnvironment(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("The runtime environment must be a private regular file (mode 0600).");
  }
  return parseEnv(readFileSync(path, "utf8"));
}

export function localDatabase(databaseUrl) {
  let parsed;
  try { parsed = new URL(databaseUrl); } catch { throw new Error("A local PostgreSQL DATABASE_URL is required."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    throw new Error("Oracle runtime requires PostgreSQL on loopback.");
  }
  if (!parsed.pathname || parsed.pathname === "/") throw new Error("A database name is required.");
  const connectionOverrides = ["host", "hostaddr", "port", "dbname", "database", "service"];
  if ([...parsed.searchParams.keys()].some((key) => connectionOverrides.includes(key.toLowerCase()))) {
    throw new Error("Database connection parameters cannot override the loopback target.");
  }
  return parsed;
}

export function runtimeEnvironment(environment) {
  localDatabase(environment.DATABASE_URL);
  const port = Number(environment.PORT ?? "3400");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PORT must be an unprivileged TCP port.");
  if (environment.AUTH_DEV_LOGIN === "1") throw new Error("Development sign-in cannot be enabled in the Oracle runtime.");
  return { ...environment, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port), NEXT_TELEMETRY_DISABLED: "1" };
}

if (isEntrypoint(import.meta.url)) {
  try {
    if (process.platform !== "linux" || process.arch !== "arm64") throw new Error("This release targets Linux ARM64.");
    const args = process.argv.slice(2);
    if (args.length !== 0 && (args.length !== 2 || args[0] !== "--env-file")) throw new Error("Usage: start.mjs [--env-file <private file>]");
    const environment = args.length ? { ...process.env, ...protectedEnvironment(args[1]) } : process.env;
    Object.assign(process.env, runtimeEnvironment(environment));
    const release = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    process.chdir(release);
    await import(pathToFileURL(resolve(release, "server.js")).href);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "TextText could not start.");
    process.exitCode = 1;
  }
}
