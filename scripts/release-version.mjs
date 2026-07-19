#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const plistBuddy = "/usr/libexec/PlistBuddy";
const versionPattern = /^\d+(?:\.\d+)+$/;

function plistVersion(pathname) {
  const path = pathname instanceof URL ? fileURLToPath(pathname) : pathname;
  if (!existsSync(path)) return null;
  const value = execFileSync(
    plistBuddy,
    ["-c", "Print :CFBundleShortVersionString", path],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
  return versionPattern.test(value) ? value : null;
}

function generatedRelease() {
  const pathname = new URL("src/generated/app-release.ts", root);
  const source = readFileSync(pathname, "utf8");
  const version = source.match(/version:\s*["']([^"']+)["']/)?.[1] ?? null;
  const zipUrl = source.match(/zipUrl:\s*(?:\n\s*)?["']([^"']+)["']/)?.[1];
  if (!version || !versionPattern.test(version) || !zipUrl) {
    throw new Error("src/generated/app-release.ts has no usable release identity");
  }
  const url = new URL(zipUrl);
  return { version, blobBase: url.origin };
}

function versionParts(version) {
  if (!versionPattern.test(version)) throw new Error(`Invalid version: ${version}`);
  return version.split(".").map(Number);
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function incrementVersion(version) {
  const parts = versionParts(version);
  parts[parts.length - 1] += 1;
  return parts.join(".");
}

async function artifactStatus(url) {
  const response = await fetch(url, {
    method: "HEAD",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  return response.status;
}

async function assertVersionFree(version, blobBase) {
  const urls = [
    `${blobBase}/downloads/Write-${version}.zip`,
    `${blobBase}/downloads/appcast-${version}.xml`,
  ];
  const statuses = await Promise.all(urls.map(artifactStatus));
  const unexpected = urls.filter(
    (_, index) => statuses[index] !== 200 && statuses[index] !== 404,
  );
  if (unexpected.length > 0) {
    const detail = unexpected
      .map((url) => `${url} (${statuses[urls.indexOf(url)]})`)
      .join(", ");
    throw new Error(`Could not verify release artifacts: ${detail}`);
  }
  const occupied = urls.filter((_, index) => statuses[index] === 200);
  if (occupied.length > 0) {
    const detail = occupied
      .map((url) => `${url} (${statuses[urls.indexOf(url)]})`)
      .join(", ");
    throw new Error(`Release ${version} is not free: ${detail}`);
  }
}

async function nextVersion() {
  const generated = generatedRelease();
  const candidates = [
    generated.version,
    plistVersion(new URL("mac/Info.plist", root)),
    plistVersion("/Applications/Write.app/Contents/Info.plist"),
  ].filter(Boolean);
  let candidate = incrementVersion(
    candidates.reduce((latest, version) =>
      compareVersions(version, latest) > 0 ? version : latest,
    ),
  );
  while (true) {
    try {
      await assertVersionFree(candidate, generated.blobBase);
      return candidate;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("Release ")) {
        throw error;
      }
      console.error(error.message);
      candidate = incrementVersion(candidate);
    }
  }
}

const [command = "next", version] = process.argv.slice(2);
try {
  if (command === "next") {
    process.stdout.write(`${await nextVersion()}\n`);
  } else if (command === "assert-free") {
    if (!version || !versionPattern.test(version)) {
      throw new Error("usage: release-version.mjs assert-free <version>");
    }
    await assertVersionFree(version, generatedRelease().blobBase);
    process.stdout.write(`${version} is free\n`);
  } else {
    throw new Error("usage: release-version.mjs [next | assert-free <version>]");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
