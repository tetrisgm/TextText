import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, normalize } from "node:path";
import { stat } from "node:fs/promises";

const VERSION = "[0-9]+(?:\\.[0-9]+)+";
const RELEASE_KEY = new RegExp(`^downloads/(TextText-${VERSION}\\.zip|appcast-${VERSION}\\.xml)$`);
const INSTALLER_SOURCE = readFileSync(new URL("./install-release-artifact.mjs", import.meta.url), "utf8");

export function releasePublicBase(env = process.env) {
  if (!env.TEXTTEXT_PRODUCT_ORIGIN) throw new Error("TEXTTEXT_PRODUCT_ORIGIN must be configured before releasing.");
  const base = new URL(env.TEXTTEXT_PRODUCT_ORIGIN);
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash ||
    /(?:\.blob\.vercel-storage\.com|\.r2\.cloudflarestorage\.com)$/i.test(base.hostname)
  ) throw new Error("TEXTTEXT_PRODUCT_ORIGIN must be the product HTTPS origin.");
  return base.origin;
}

function configuredOracleHost(env, home) {
  const explicit = env.TEXTTEXT_ORACLE_HOST?.trim();
  if (explicit) return explicit;
  const file = join(home, ".config/texttext/oracle-host");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "";
}

export function releaseStorageConfig(env = process.env, { home = homedir() } = {}) {
  const base = releasePublicBase(env);
  const host = configuredOracleHost(env, home);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._@-]*$/.test(host)) {
    throw new Error("Set TEXTTEXT_ORACLE_HOST to the existing Oracle SSH destination.");
  }
  const remoteRoot = env.TEXTTEXT_ORACLE_ROOT || "/home/ubuntu/texttext";
  if (
    !/^\/home\/ubuntu\/[a-zA-Z0-9/_-]+$/.test(remoteRoot) ||
    normalize(remoteRoot) !== remoteRoot ||
    remoteRoot.split("/").some((segment) => ["releases", "incoming", "current", "backups", "release-artifacts"].includes(segment))
  ) {
    throw new Error("Oracle root must be an isolated path under /home/ubuntu.");
  }
  const artifactRoot = `${remoteRoot}/release-artifacts`;
  const minFreeBytes = Number(env.TEXTTEXT_STORAGE_MIN_FREE_BYTES || String(2 * 1024 * 1024 * 1024));
  if (!Number.isSafeInteger(minFreeBytes) || minFreeBytes < 0) {
    throw new Error("TEXTTEXT_STORAGE_MIN_FREE_BYTES must be a nonnegative integer.");
  }
  return {
    base,
    host,
    remoteRoot,
    artifactRoot,
    minFreeBytes,
    sshOptions: [
      "-i", join(home, ".ssh/id_ed25519"),
      "-o", "IdentitiesOnly=yes",
      "-o", "BatchMode=yes",
      "-o", "ConnectTimeout=10",
    ],
  };
}

export async function inspectReleaseFile(file) {
  const info = await stat(file);
  if (!info.isFile() || info.size <= 0) throw new Error("Release artifact is missing or empty.");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { length: info.size, sha256: hash.digest("hex") };
}

function releaseFilename(key, contentType) {
  const match = key.match(RELEASE_KEY);
  if (!match) throw new Error("Invalid immutable release key.");
  const expected = match[1].endsWith(".zip") ? "application/zip" : "application/xml; charset=utf-8";
  if (contentType !== expected) throw new Error("Invalid release artifact content type.");
  return match[1];
}

function runCommand(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const detail = typeof error?.stderr === "string" ? error.stderr.trim() : "";
    throw new Error(detail || `Oracle release artifact ${command} command failed.`);
  }
}

function remoteInstaller(config, command, args, run) {
  return run(
    "ssh",
    [...config.sshOptions, config.host, "/usr/bin/node", "--input-type=module", "-", command, config.artifactRoot, ...args],
    { input: INSTALLER_SOURCE },
  );
}

/** Upload to a private temporary path, then verify and atomically link it on Oracle. */
export async function uploadReleaseFile(
  config,
  key,
  file,
  contentType,
  identity,
  { run = runCommand, token = randomBytes(8).toString("hex") } = {},
) {
  const filename = releaseFilename(key, contentType);
  if (!Number.isSafeInteger(identity?.length) || identity.length <= 0 || !/^[a-f0-9]{64}$/.test(identity?.sha256 ?? "")) {
    throw new Error("Invalid release artifact identity.");
  }
  if (!/^[a-f0-9]{16}$/.test(token)) throw new Error("Invalid transfer token.");
  const temporary = `${config.artifactRoot}/.incoming-${filename}-${token}.tmp`;
  let prepared = false;
  try {
    remoteInstaller(config, "prepare", [temporary, String(identity.length), String(config.minFreeBytes)], run);
    prepared = true;
    run("scp", [...config.sshOptions, file, `${config.host}:${temporary}`]);
    remoteInstaller(
      config,
      "install",
      [temporary, filename, String(identity.length), identity.sha256, String(config.minFreeBytes)],
      run,
    );
    prepared = false;
  } catch (error) {
    if (prepared) {
      try { remoteInstaller(config, "discard", [temporary], run); } catch { /* preserve the original failure */ }
    }
    throw error;
  }
}

export function inspectAppcast(xml, version, zipUrl, zipLength) {
  const buildNumber = Number(xml.match(/<sparkle:version>(\d+)<\/sparkle:version>/)?.[1]);
  if (!Number.isSafeInteger(buildNumber) || buildNumber <= 0) throw new Error("Appcast has no usable build number.");
  if (xml.match(/<sparkle:shortVersionString>([^<]+)<\/sparkle:shortVersionString>/)?.[1] !== version) throw new Error("Appcast version does not match the release.");
  if (xml.match(/<sparkle:hardwareRequirements>([^<]+)<\/sparkle:hardwareRequirements>/)?.[1]?.trim() !== "arm64") throw new Error("Appcast must require arm64.");
  const enclosures = [...xml.matchAll(/<enclosure\s[^>]*>/g)];
  if (enclosures.length !== 1) throw new Error("Appcast must contain exactly one release enclosure.");
  const enclosure = enclosures[0][0];
  if (enclosure.match(/\burl="([^"]+)"/)?.[1] !== zipUrl || Number(enclosure.match(/\blength="(\d+)"/)?.[1]) !== zipLength || !/sparkle:edSignature="[A-Za-z0-9+/]{86}=="/.test(enclosure)) throw new Error("Appcast enclosure URL, size or signature is invalid.");
  return buildNumber;
}

export async function verifyPublicArtifact(url, identity, fetcher = fetch) {
  const response = await fetcher(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(600_000) });
  if (!response.ok || !response.body) throw new Error("Release artifact is not available through the product origin.");
  const reader = response.body.getReader(), hash = createHash("sha256");
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > identity.length) throw new Error("Public release artifact exceeds its expected size.");
      hash.update(next.value);
    }
    if (length !== identity.length || hash.digest("hex") !== identity.sha256) throw new Error("Public release artifact does not match the signed local artifact.");
  } finally {
    await reader.cancel().catch(() => {});
  }
}
