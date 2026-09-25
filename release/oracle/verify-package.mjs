#!/usr/bin/env node
import { createReadStream, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export async function verifyPackage(archive) {
  const checksum = readFileSync(`${archive}.sha256`, "utf8").trim();
  const [expected, name] = checksum.split(/\s+/, 2);
  if (!/^[a-f0-9]{64}$/.test(expected) || name !== basename(archive)) throw new Error("Release checksum file is invalid.");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  if (hash.digest("hex") !== expected) throw new Error("Release archive checksum mismatch.");
  const listing = spawnSync("tar", ["-tzf", archive], { encoding: "utf8", maxBuffer: 16 * 1024 ** 2 });
  if (listing.error || listing.status !== 0) throw new Error("Release archive cannot be read.");
  for (const entry of listing.stdout.trim().split("\n")) {
    const parts = entry.split("/");
    if (entry.startsWith("/") || parts.includes("..") || parts.some((part) => part === ".env" || part.startsWith(".env.") || part === ".npmrc")) {
      throw new Error("Release archive contains an unsafe path or environment file.");
    }
  }
  const metadata = spawnSync("tar", ["-xOzf", archive, "./oracle-release.json"], { encoding: "utf8" });
  if (metadata.error || metadata.status !== 0) throw new Error("Release metadata is missing.");
  let manifest;
  try { manifest = JSON.parse(metadata.stdout); } catch { throw new Error("Release metadata is invalid."); }
  if (manifest.platform !== "linux" || manifest.architecture !== "arm64" || manifest.nodeMajor !== 22 || !/^[a-f0-9]{40}$/.test(manifest.commit) || !/^[a-zA-Z0-9_.-]+$/.test(manifest.deploymentId || "")) {
    throw new Error("Release metadata must identify Linux ARM64, Node 22, source commit, and deployment.");
  }
  const lockfile = spawnSync("tar", ["-xOzf", archive, "./package-lock.json"], { maxBuffer: 16 * 1024 ** 2 });
  if (lockfile.error || lockfile.status !== 0 || createHash("sha256").update(lockfile.stdout).digest("hex") !== manifest.lockfileSha256) {
    throw new Error("Release dependency lockfile does not match its manifest.");
  }
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: verify-package.mjs <archive.tar.gz>");
    console.log(JSON.stringify(await verifyPackage(resolve(process.argv[2]))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Package verification failed.");
    process.exitCode = 1;
  }
}
