#!/usr/bin/env node
// Package a Mac-verified standalone build. This never connects to a server.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { preparedRelease } from "./bootstrap-database.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function relativeBuildDirectory(projectRoot, directory) {
  const value = relative(projectRoot, resolve(projectRoot, directory));
  if (!value || value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)) {
    throw new Error("The build directory must be inside the project.");
  }
  return value;
}

export function copyWithoutSecrets(source, destination) {
  const sourceRoot = realpathSync(source);
  cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter(path) {
      const name = path.split(sep).at(-1);
      if (name === ".env" || name.startsWith(".env.") || name === ".npmrc" || name === ".git") return false;
      const target = realpathSync(path);
      const local = relative(sourceRoot, target);
      if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) {
        throw new Error("Refusing to package a symlink outside the selected tree.");
      }
      return true;
    },
  });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} failed while packaging.`);
  return result;
}

export function assertLinuxArmRuntime(directory) {
  for (const dependency of ["@img/sharp-linux-arm64", "@img/sharp-libvips-linux-arm64", "@next/swc-linux-arm64-gnu"]) {
    if (!existsSync(join(directory, "node_modules", dependency, "package.json"))) {
      throw new Error(`Missing Linux ARM64 runtime dependency: ${dependency}`);
    }
  }
  const img = join(directory, "node_modules/@img");
  if (readdirSync(img).some((name) => name.includes("darwin"))) {
    throw new Error("The runtime still contains Mac native dependencies.");
  }
}

export function packageBuild({ projectRoot = root, distDirectory = ".next", migrationsDirectory, output }) {
  const dist = relativeBuildDirectory(projectRoot, distDirectory);
  const standalone = join(projectRoot, dist, "standalone");
  if (!existsSync(join(standalone, "server.js"))) {
    throw new Error("Build with TEXTTEXT_STANDALONE=1 before packaging.");
  }
  if (!migrationsDirectory || !existsSync(join(migrationsDirectory, "manifest.json")) || !existsSync(join(migrationsDirectory, "schema.sql"))) {
    throw new Error("Prepare the migration artifact on the Mac and pass --migrations-dir.");
  }
  const migrationManifest = preparedRelease(resolve(migrationsDirectory));
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" });
  if (commit.status !== 0 || migrationManifest.commit !== commit.stdout.trim()) {
    throw new Error("Prepare database migrations from the current source commit before packaging.");
  }
  const target = resolve(output);
  if (existsSync(target) || existsSync(`${target}.sha256`)) throw new Error("Refusing to replace an existing release archive.");
  mkdirSync(dirname(target), { recursive: true });
  const temporary = mkdtempSync(join(dirname(target), ".oracle-package-"));
  const app = join(temporary, "app");
  try {
    copyWithoutSecrets(standalone, app);
    copyWithoutSecrets(join(projectRoot, dist, "static"), join(app, dist, "static"));
    if (existsSync(join(projectRoot, "public"))) copyWithoutSecrets(join(projectRoot, "public"), join(app, "public"));
    mkdirSync(join(app, dist, "cache"), { recursive: true });
    cpSync(join(projectRoot, "package.json"), join(app, "package.json"));
    cpSync(join(projectRoot, "package-lock.json"), join(app, "package-lock.json"));
    // Reinstall the locked production tree for Ubuntu ARM64. Lifecycle scripts
    // are disabled: Mac binaries must never be compiled into this archive.
    run("npm", ["ci", "--omit=dev", "--include=optional", "--ignore-scripts", "--os=linux", "--cpu=arm64", "--libc=glibc", "--no-audit", "--no-fund"], { cwd: app });
    assertLinuxArmRuntime(app);
    mkdirSync(join(app, "release/oracle"), { recursive: true });
    for (const name of ["start.mjs", "backup.mjs", "backup-remote.mjs", "bootstrap-database.mjs", "smoke.mjs"]) cpSync(join(projectRoot, "release/oracle", name), join(app, "release/oracle", name));
    copyWithoutSecrets(resolve(migrationsDirectory), join(app, "release/oracle/migrations"));
    mkdirSync(join(app, "scripts/lib"), { recursive: true });
    cpSync(join(projectRoot, "scripts/verify-production-database.mjs"), join(app, "scripts/verify-production-database.mjs"));
    cpSync(join(projectRoot, "scripts/lib/postgres-migration.mjs"), join(app, "scripts/lib/postgres-migration.mjs"));
    const buildFiles = JSON.parse(readFileSync(join(projectRoot, dist, "required-server-files.json"), "utf8"));
    writeFileSync(join(app, "oracle-release.json"), JSON.stringify({
      commit: commit.stdout.trim(),
      builtAt: new Date().toISOString(),
      platform: "linux", architecture: "arm64", nodeMajor: 22,
      distDirectory: dist,
      deploymentId: buildFiles.config.deploymentId ?? null,
      lockfileSha256: createHash("sha256").update(readFileSync(join(app, "package-lock.json"))).digest("hex"),
    }, null, 2) + "\n");
    const archive = join(temporary, "release.tar.gz");
    run("tar", ["-czf", archive, "-C", app, "."], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
    cpSync(archive, target, { errorOnExist: true, force: false });
    const digest = createHash("sha256").update(readFileSync(target)).digest("hex");
    writeFileSync(`${target}.sha256`, `${digest}  ${target.split(sep).at(-1)}\n`, { flag: "wx" });
    return target;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    let distDirectory = ".next";
    let migrationsDirectory;
    let output;
    for (let index = 2; index < process.argv.length; index += 2) {
      const key = process.argv[index];
      const value = process.argv[index + 1];
      if (!value || !["--dist-dir", "--migrations-dir", "--out"].includes(key)) throw new Error("Usage: package.mjs --out <new archive.tar.gz> --migrations-dir <prepared directory> [--dist-dir .next]");
      if (key === "--dist-dir") distDirectory = value;
      if (key === "--migrations-dir") migrationsDirectory = value;
      if (key === "--out") output = value;
    }
    if (!output) throw new Error("Usage: package.mjs --out <new archive.tar.gz> --migrations-dir <prepared directory> [--dist-dir .next]");
    console.log(packageBuild({ distDirectory, migrationsDirectory, output }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Packaging failed.");
    process.exitCode = 1;
  }
}
