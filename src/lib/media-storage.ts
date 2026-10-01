import { randomUUID } from "node:crypto";
import {
  lstat,
  link,
  mkdir,
  open,
  readdir,
  readFile,
  rm,
  rmdir,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";

const MAX_BYTES = 50 * 1024 * 1024;
const PAGE_SIZE = 100;
const SINGLE_BYTE_RANGE = /^bytes=(?:\d+-\d*|-\d+)$/;
const CONTENT_TYPE = /^(?:image|video)\/[a-z0-9!#$&^_.+-]+$/i;

type Configuration = {
  root: string;
  objects: string;
  metadata: string;
  origin: string;
};

type StoredMetadata = {
  version: 1;
  contentType: string;
  size: number;
};

export function isMediaStorageConfigured(): boolean {
  return Boolean(process.env.TEXTTEXT_MEDIA_ROOT && process.env.MEDIA_ORIGIN);
}

function configuredOrigin(): string {
  const origin = new URL(process.env.MEDIA_ORIGIN!);
  if (
    (origin.protocol !== "https:" &&
      !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname))) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) throw new Error("Invalid media origin configuration.");
  return origin.origin;
}

function configuration(): Configuration {
  if (!isMediaStorageConfigured()) throw new Error("Document asset storage is not configured.");
  const configured = process.env.TEXTTEXT_MEDIA_ROOT!;
  if (!isAbsolute(configured) || configured.includes("\0")) {
    throw new Error("Invalid media storage root configuration.");
  }
  const root = resolve(configured);
  return { root, objects: join(root, "objects"), metadata: join(root, "metadata"), origin: configuredOrigin() };
}

async function ensureStorage(config: Configuration): Promise<void> {
  await mkdir(config.root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(config.root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("Media storage root must not be a symbolic link.");
  }
  await Promise.all([
    mkdir(config.objects, { recursive: true, mode: 0o700 }),
    mkdir(config.metadata, { recursive: true, mode: 0o700 }),
  ]);
  for (const directory of [config.objects, config.metadata]) {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid media storage directory.");
  }
}

function containedPath(root: string, key: string, suffix = ""): string {
  const target = resolve(root, ...key.split("/")) + suffix;
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("Invalid media path.");
  return target;
}

async function ensureContainedParent(root: string, target: string): Promise<void> {
  const parent = dirname(target);
  const relativeParent = relative(root, parent);
  if (relativeParent.startsWith("..") || isAbsolute(relativeParent)) throw new Error("Invalid media path.");
  let current = root;
  for (const part of relativeParent.split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid media storage directory.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try { await mkdir(current, { mode: 0o700 }); }
      catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== "EEXIST") throw mkdirError;
        const info = await lstat(current);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid media storage directory.");
      }
    }
  }
}

async function writeExclusive(target: string, bytes: Uint8Array): Promise<void> {
  const temporary = join(dirname(target), `.texttext-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, target);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function metadataFor(config: Configuration, key: string): Promise<StoredMetadata | null> {
  try {
    const raw = await readFile(containedPath(config.metadata, key, ".json"), "utf8");
    if (raw.length > 1024) return null;
    const value = JSON.parse(raw) as Partial<StoredMetadata>;
    if (
      value.version !== 1 ||
      typeof value.contentType !== "string" ||
      !CONTENT_TYPE.test(value.contentType) ||
      !Number.isSafeInteger(value.size) ||
      value.size! <= 0 ||
      value.size! > MAX_BYTES
    ) return null;
    return value as StoredMetadata;
  } catch { return null; }
}

export function validMediaKey(key: string): boolean {
  return key.length <= 1024 &&
    /^(?:documents|captures)\/[a-z0-9-]+\/|^editor\/media\/[a-z0-9-]+\//.test(key) &&
    key.split("/").every(segment => /^[a-zA-Z0-9._-]+$/.test(segment) && segment !== "." && segment !== "..");
}

export function mediaUrl(key: string): string {
  if (!validMediaKey(key)) throw new Error("Invalid media path.");
  return `${configuredOrigin()}/api/media/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function mediaKeyFromUrl(value: string): string | null {
  try {
    const url = new URL(value), origin = new URL(process.env.MEDIA_ORIGIN!);
    if (url.origin !== origin.origin || url.search || url.hash || !url.pathname.startsWith("/api/media/")) return null;
    const key = decodeURIComponent(url.pathname.slice("/api/media/".length));
    return validMediaKey(key) && mediaUrl(key) === url.toString() ? key : null;
  } catch { return null; }
}

export async function put(
  pathname: string,
  body: Blob | Uint8Array,
  options: { contentType: string },
) {
  if (!validMediaKey(pathname)) throw new Error("Invalid media path.");
  if (!CONTENT_TYPE.test(options.contentType)) throw new Error("Invalid media content type.");
  const bytes = body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : body;
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) throw new Error("Media must be between 1 byte and 50 MB.");

  const slash = pathname.lastIndexOf("/");
  const key = `${pathname.slice(0, slash + 1)}${randomUUID()}-${pathname.slice(slash + 1)}`;
  const config = configuration();
  await ensureStorage(config);
  const objectPath = containedPath(config.objects, key);
  const metadataPath = containedPath(config.metadata, key, ".json");
  await Promise.all([
    ensureContainedParent(config.objects, objectPath),
    ensureContainedParent(config.metadata, metadataPath),
  ]);
  const metadata = new TextEncoder().encode(JSON.stringify({
    version: 1,
    contentType: options.contentType,
    size: bytes.byteLength,
  } satisfies StoredMetadata));
  try {
    await writeExclusive(objectPath, bytes);
    await writeExclusive(metadataPath, metadata);
    await Promise.all([syncDirectory(dirname(objectPath)), syncDirectory(dirname(metadataPath))]);
  } catch (error) {
    await Promise.allSettled([rm(objectPath, { force: true }), rm(metadataPath, { force: true })]);
    throw error;
  }
  return { url: mediaUrl(key), pathname: key, contentType: options.contentType };
}

async function removeEmptyParents(path: string, root: string): Promise<void> {
  let current = dirname(path);
  while (current !== root && current.startsWith(`${root}${sep}`)) {
    try { await rmdir(current); } catch { return; }
    current = dirname(current);
  }
}

function ignoreMissing(error: unknown): void {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

export async function del(urls: string | string[]): Promise<void> {
  const keys = [...new Set((Array.isArray(urls) ? urls : [urls])
    .map(mediaKeyFromUrl)
    .filter((key): key is string => Boolean(key)))];
  if (!keys.length) return;
  const config = configuration();
  await ensureStorage(config);
  for (const key of keys) {
    const objectPath = containedPath(config.objects, key);
    const metadataPath = containedPath(config.metadata, key, ".json");
    await Promise.all([unlink(objectPath).catch(ignoreMissing), unlink(metadataPath).catch(ignoreMissing)]);
    await Promise.all([
      removeEmptyParents(objectPath, config.objects),
      removeEmptyParents(metadataPath, config.metadata),
    ]);
  }
}

async function collectKeys(root: string, directory: string, after: string | null, output: string[]): Promise<void> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const entry of entries) {
    const pathname = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Invalid symbolic link in media storage.");
    if (entry.isDirectory()) await collectKeys(root, pathname, after, output);
    else if (entry.isFile()) {
      const key = relative(root, pathname).split(sep).join("/");
      if ((!after || key > after) && validMediaKey(key)) output.push(key);
    }
  }
}

function encodeCursor(key: string): string { return Buffer.from(key, "utf8").toString("base64url"); }
function decodeCursor(cursor: string | undefined, prefix: string): string | null {
  if (!cursor) return null;
  try {
    const key = Buffer.from(cursor, "base64url").toString("utf8");
    if (encodeCursor(key) !== cursor || !validMediaKey(key) || !key.startsWith(prefix)) throw new Error();
    return key;
  } catch { throw new Error("Invalid media listing cursor."); }
}

export async function list(options: { prefix: string; cursor?: string }) {
  if (!options.prefix.endsWith("/") || !validMediaKey(`${options.prefix}probe`)) throw new Error("Invalid media prefix.");
  const config = configuration();
  await ensureStorage(config);
  const after = decodeCursor(options.cursor, options.prefix);
  const keys: string[] = [];
  await collectKeys(config.objects, containedPath(config.objects, options.prefix), after, keys);
  const verified: string[] = [];
  for (const key of keys) {
    if (await metadataFor(config, key)) verified.push(key);
    if (verified.length > PAGE_SIZE) break;
  }
  const page = verified.slice(0, PAGE_SIZE);
  return {
    blobs: page.map(pathname => ({ pathname, url: mediaUrl(pathname) })),
    hasMore: verified.length > PAGE_SIZE,
    cursor: verified.length > PAGE_SIZE ? encodeCursor(page[page.length - 1]) : undefined,
  };
}

function rangeFor(value: string, size: number): { start: number; end: number } | null {
  if (!SINGLE_BYTE_RANGE.test(value)) return null;
  const [startText, endText] = value.slice(6).split("-");
  let start: number, end: number;
  if (!startText) {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

function missing(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
}

/** Caller must authorize before invoking this function. Never cache private media at a shared layer. */
export async function readMedia(key: string, range: string | null): Promise<Response> {
  if (!validMediaKey(key)) return missing();
  if (range && !SINGLE_BYTE_RANGE.test(range)) return new Response(null, { status: 416 });
  const config = configuration();
  await ensureStorage(config);
  const objectPath = containedPath(config.objects, key);
  const metadata = await metadataFor(config, key);
  if (!metadata) return missing();
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const linkInfo = await lstat(objectPath);
    if (!linkInfo.isFile() || linkInfo.isSymbolicLink()) return missing();
    handle = await open(objectPath, "r");
    const info = await handle.stat();
    if (info.dev !== linkInfo.dev || info.ino !== linkInfo.ino || info.size !== metadata.size) {
      await handle.close();
      return missing();
    }
  } catch {
    await handle?.close().catch(() => {});
    return missing();
  }
  if (!handle) return missing();

  const selected = range ? rangeFor(range, metadata.size) : null;
  if (range && !selected) {
    await handle.close();
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${metadata.size}`, "Cache-Control": "private, no-store" },
    });
  }
  const start = selected?.start ?? 0;
  const end = selected?.end ?? metadata.size - 1;
  const stream = handle.createReadStream({ start, end, autoClose: true });
  const headers = new Headers({
    "Content-Type": metadata.contentType,
    "Content-Length": String(end - start + 1),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Accept-Ranges": "bytes",
  });
  if (selected) headers.set("Content-Range", `bytes ${start}-${end}/${metadata.size}`);
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: selected ? 206 : 200,
    headers,
  });
}
