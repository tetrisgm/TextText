import { appendFileSync, createReadStream, createWriteStream, fstatSync, lstatSync, openSync, closeSync, readSync, rmSync, writeFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { basename } from "node:path";
import { pipeline } from "node:stream/promises";

const magic = Buffer.from("TTBACKUP1");
const headerSize = magic.length + 12;
const prefix = "backups/oracle/texttext/";
const remoteName = /^backups\/oracle\/texttext\/texttext-(\d{8})T\d{6}Z-[a-f0-9]{8}\.dump\.aes256gcm$/;

function encryptionKey(value) {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error("BACKUP_ENCRYPTION_KEY must be a dedicated 32-byte base64 key.");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY must be a dedicated 32-byte base64 key.");
  return key;
}

export async function encryptBackup(source, output, value) {
  const key = encryptionKey(value);
  const iv = randomBytes(12);
  const header = Buffer.concat([magic, iv]);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(header);
  writeFileSync(output, header, { mode: 0o600, flag: "wx" });
  try {
    await pipeline(createReadStream(source), cipher, createWriteStream(output, { flags: "a" }));
    appendFileSync(output, cipher.getAuthTag());
  } catch (error) {
    rmSync(output, { force: true });
    throw error;
  }
}

export async function decryptBackup(source, output, value) {
  const key = encryptionKey(value);
  const stat = lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < headerSize + 16) throw new Error("Invalid encrypted backup.");
  const header = Buffer.alloc(headerSize);
  const tag = Buffer.alloc(16);
  const fd = openSync(source, "r");
  try {
    readSync(fd, header, 0, header.length, 0);
    readSync(fd, tag, 0, tag.length, stat.size - tag.length);
  } finally { closeSync(fd); }
  if (!header.subarray(0, magic.length).equals(magic)) throw new Error("Unrecognized backup format.");
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(magic.length));
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  let outputFd;
  try { outputFd = openSync(output, "wx", 0o600); } catch (error) {
    if (error.code === "EEXIST") throw new Error("Refusing to replace an existing decrypted backup.");
    throw error;
  }
  const ownedFile = fstatSync(outputFd);
  try {
    await pipeline(createReadStream(source, { start: headerSize, end: stat.size - 17 }), decipher, createWriteStream(output, { fd: outputFd, autoClose: true }));
  } catch {
    let current;
    try { current = lstatSync(output); } catch { /* The owned path may already have been removed. */ }
    if (current?.ino === ownedFile.ino && current?.dev === ownedFile.dev) rmSync(output);
    throw new Error("Backup authentication failed; no decrypted file was retained.");
  }
}

async function sha256(stream, maxBytes) {
  let count = 0;
  const hash = createHash("sha256");
  for await (const chunk of stream) {
    count += chunk.length;
    if (count > maxBytes) throw new Error("Backup verification exceeded its size limit.");
    hash.update(chunk);
  }
  return { digest: hash.digest("hex"), size: count };
}

export function remoteRetention(blobs, { keep, maxBytes, requiredPath }) {
  const sorted = [...blobs].sort((a, b) => {
    // The newly verified copy survives clock changes and same-second runs.
    if (a.pathname === requiredPath) return -1;
    if (b.pathname === requiredPath) return 1;
    return b.pathname.localeCompare(a.pathname);
  });
  const days = new Set();
  let bytes = 0;
  return sorted.map((blob) => {
    const match = blob.pathname.match(remoteName);
    if (!match) throw new Error("Unexpected object in the backup prefix; nothing was pruned.");
    const retain = !days.has(match[1]) && days.size < keep && bytes + blob.size <= maxBytes;
    if (retain) { days.add(match[1]); bytes += blob.size; }
    if (blob.pathname === requiredPath && !retain) throw new Error("The verified backup does not fit the retention budget.");
    return { ...blob, remove: !retain };
  });
}

export async function uploadEncryptedBackup(source, environment, suppliedClient) {
  encryptionKey(environment.BACKUP_ENCRYPTION_KEY);
  if (!environment.BLOB_READ_WRITE_TOKEN) throw new Error("Off-server backup requires the existing Blob store token.");
  const maxFileBytes = Number(environment.TEXTTEXT_BACKUP_UPLOAD_MAX_BYTES || String(100 * 1024 ** 2));
  const maxTotalBytes = Number(environment.TEXTTEXT_BACKUP_REMOTE_MAX_BYTES || String(500 * 1024 ** 2));
  const keep = Number(environment.TEXTTEXT_BACKUP_KEEP || "7");
  if (![maxFileBytes, maxTotalBytes, keep].every(Number.isSafeInteger) || maxFileBytes < 1024 || maxTotalBytes < maxFileBytes || keep < 1 || keep > 31) {
    throw new Error("Invalid off-server backup budget.");
  }
  if (lstatSync(source).size + headerSize + 16 > maxFileBytes) throw new Error("Backup is larger than the off-server upload budget.");
  const access = environment.TEXTTEXT_BACKUP_BLOB_ACCESS || "public";
  if (!["public", "private"].includes(access)) throw new Error("Invalid backup Blob access setting.");
  const blob = suppliedClient || await import("@vercel/blob");
  const options = { token: environment.BLOB_READ_WRITE_TOKEN, abortSignal: AbortSignal.timeout(120_000) };
  let before;
  try { before = await blob.list({ ...options, prefix, limit: 100 }); } catch {
    throw new Error("Could not read the off-server backup inventory; nothing was uploaded or pruned.");
  }
  if (before.hasMore) throw new Error("Backup prefix has more than 100 objects; reconcile retention before uploading.");
  remoteRetention(before.blobs, { keep, maxBytes: maxTotalBytes });
  const file = `${source}.encrypted.partial`;
  const pathname = `${prefix}${basename(source)}.aes256gcm`;
  if (!remoteName.test(pathname)) throw new Error("Unexpected backup filename.");
  let uploaded;
  let verified = false;
  try {
    await encryptBackup(source, file, environment.BACKUP_ENCRYPTION_KEY);
    const expected = await sha256(createReadStream(file), maxFileBytes);
    const oldBytes = before.blobs.reduce((total, entry) => total + entry.size, 0);
    if (oldBytes + expected.size > maxTotalBytes + maxFileBytes) throw new Error("Off-server backup exceeds its temporary upload budget.");
    uploaded = await blob.put(pathname, createReadStream(file), { ...options, access, addRandomSuffix: false, allowOverwrite: false, contentType: "application/octet-stream", multipart: true });
    const download = await blob.get(uploaded.url, { ...options, access });
    if (!download || download.statusCode !== 200) throw new Error("Uploaded backup could not be verified.");
    const actual = await sha256(download.stream, maxFileBytes);
    if (expected.digest !== actual.digest || expected.size !== actual.size) throw new Error("Uploaded backup failed digest verification.");
    verified = true;
    const after = [...before.blobs, { pathname, url: uploaded.url, size: expected.size }];
    const expired = remoteRetention(after, { keep, maxBytes: maxTotalBytes, requiredPath: pathname }).filter((entry) => entry.remove);
    if (expired.length) await blob.del(expired.map((entry) => entry.url), options);
  } catch {
    if (uploaded && !verified) await blob.del(uploaded.url, options).catch(() => {});
    if (verified) throw new Error("Off-server backup was verified, but retention cleanup failed; the new backup was retained.");
    throw new Error("Off-server backup failed; previous verified backups were preserved.");
  } finally {
    rmSync(file, { force: true });
  }
}
