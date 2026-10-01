#!/usr/bin/env node

import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, statfs, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "[0-9]+(?:\\.[0-9]+)+";
const RELEASE_FILENAME = new RegExp(`^(?:TextText-${VERSION}\\.zip|appcast-${VERSION}\\.xml)$`);
const TEMP_FILENAME = /^\.incoming-(?:TextText-[0-9]+(?:\.[0-9]+)+\.zip|appcast-[0-9]+(?:\.[0-9]+)+\.xml)-[a-f0-9]{16}\.tmp$/;
const DEFAULT_MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024;

function isEntrypoint(metaUrl) {
  return process.argv[1] === "-" || (process.argv[1] && fileURLToPath(metaUrl) === process.argv[1]);
}

export function validReleaseFilename(filename) {
  return RELEASE_FILENAME.test(filename);
}

export function validateArtifactRoot(root, { production = false } = {}) {
  if (!root || !isAbsolute(root) || normalize(root) !== root || basename(root) !== "release-artifacts") {
    throw new Error("Invalid release artifact root.");
  }
  const segments = root.split("/");
  if (segments.some((segment) => ["releases", "incoming", "current", "backups"].includes(segment))) {
    throw new Error("Release artifacts must stay outside deployment and backup directories.");
  }
  if (production && !/^\/home\/ubuntu\/[a-zA-Z0-9/_-]+\/release-artifacts$/.test(root)) {
    throw new Error("Release artifacts must be under /home/ubuntu.");
  }
  return root;
}

function validateTemporary(root, temporary, filename) {
  if (!temporary || dirname(temporary) !== root || !TEMP_FILENAME.test(basename(temporary))) {
    throw new Error("Invalid release artifact temporary path.");
  }
  if (filename && !basename(temporary).startsWith(`.incoming-${filename}-`)) {
    throw new Error("Temporary path does not match the release artifact.");
  }
}

async function requirePlainDirectory(root) {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Release artifact root must be a real directory.");
}

function validateByteBudget(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}.`);
}

async function requireStorageHeadroom(root, reserveBytes, minFreeBytes, statfsImpl = statfs) {
  validateByteBudget(reserveBytes, "release artifact size");
  validateByteBudget(minFreeBytes, "minimum free storage");
  const storage = await statfsImpl(root, { bigint: true });
  const available = storage.bavail * storage.bsize;
  if (available < BigInt(reserveBytes) + BigInt(minFreeBytes)) {
    throw new Error("Oracle does not have enough free storage for this release artifact.");
  }
}

export async function prepareReleaseArtifact(root, temporary, {
  length = 0,
  minFreeBytes = DEFAULT_MIN_FREE_BYTES,
  statfsImpl = statfs,
} = {}) {
  validateArtifactRoot(root);
  validateTemporary(root, temporary);
  try {
    await mkdir(root, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  await requirePlainDirectory(root);
  await chmod(root, 0o700);
  await requireStorageHeadroom(root, length, minFreeBytes, statfsImpl);
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  await handle.close();
}

export async function discardReleaseArtifact(root, temporary) {
  validateArtifactRoot(root);
  validateTemporary(root, temporary);
  try {
    await unlink(temporary);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function inspectPlainFile(pathname) {
  const handle = await open(pathname, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size <= 0) throw new Error("Release artifact must be a nonempty regular file.");
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) hash.update(chunk);
    return { length: info.size, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

async function syncPath(pathname) {
  const handle = await open(pathname, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function installReleaseArtifact({
  root,
  temporary,
  filename,
  length,
  sha256,
  minFreeBytes = DEFAULT_MIN_FREE_BYTES,
  statfsImpl = statfs,
}) {
  validateArtifactRoot(root);
  if (!validReleaseFilename(filename)) throw new Error("Invalid immutable release filename.");
  validateTemporary(root, temporary, filename);
  if (!Number.isSafeInteger(length) || length <= 0 || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("Invalid release artifact identity.");
  }
  await requirePlainDirectory(root);
  const incoming = await inspectPlainFile(temporary);
  if (incoming.length !== length || incoming.sha256 !== sha256) {
    await unlink(temporary).catch(() => {});
    throw new Error("Transferred release artifact failed server verification.");
  }
  try {
    await requireStorageHeadroom(root, 0, minFreeBytes, statfsImpl);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  await chmod(temporary, 0o600);
  const destination = `${root}/${filename}`;
  try {
    await link(temporary, destination);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    try {
      const existing = await inspectPlainFile(destination);
      if (existing.length !== length || existing.sha256 !== sha256) {
        throw new Error("An immutable release artifact already exists with different bytes.");
      }
      return { created: false, ...existing };
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  await chmod(destination, 0o600);
  await syncPath(destination);
  await syncPath(root);
  await unlink(temporary);
  return { created: true, ...incoming };
}

export async function runInstallerCommand(argv, { production = true } = {}) {
  const [command, root, temporary, ...argumentsForCommand] = argv;
  validateArtifactRoot(root, { production });
  if (command === "prepare" && temporary && argumentsForCommand.length === 2) {
    const [length, minimumFree] = argumentsForCommand;
    await prepareReleaseArtifact(root, temporary, { length: Number(length), minFreeBytes: Number(minimumFree) });
    return "";
  }
  if (command === "discard" && temporary && argumentsForCommand.length === 0) {
    await discardReleaseArtifact(root, temporary);
    return "";
  }
  if (command === "install" && temporary && argumentsForCommand.length === 4) {
    const [filename, length, sha256, minimumFree] = argumentsForCommand;
    const result = await installReleaseArtifact({ root, temporary, filename, length: Number(length), sha256, minFreeBytes: Number(minimumFree) });
    return `${result.created ? "installed" : "verified"} ${filename}\n`;
  }
  throw new Error("Invalid release artifact installer invocation.");
}

if (isEntrypoint(import.meta.url)) {
  try {
    process.stdout.write(await runInstallerCommand(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Release artifact installation failed.");
    process.exitCode = 1;
  }
}
