import "server-only";

import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import { Readable } from "node:stream";

const DEFAULT_ARTIFACT_ROOT = "/home/ubuntu/texttext/release-artifacts";
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const NO_STORE = "no-store, max-age=0";
const MAX_APPCAST_BYTES = 1024 * 1024;
const VERSION = "[0-9]+(?:\\.[0-9]+)+";
const ZIP = new RegExp(`^TextText-(${VERSION})\\.zip$`);
const APPCAST = new RegExp(`^appcast-(${VERSION})\\.xml$`);
const SINGLE_BYTE_RANGE = /^bytes=(\d*)-(\d*)$/;

type ReleaseArtifact = {
  filename: string;
  contentType: string;
  ranges: boolean;
};

type ByteRange = { start: number; end: number };

export function releaseArtifactForFilename(filename: string): ReleaseArtifact | null {
  if (ZIP.test(filename)) return { filename, contentType: "application/zip", ranges: true };
  if (APPCAST.test(filename)) return { filename, contentType: "application/xml; charset=utf-8", ranges: false };
  return null;
}

function artifactRoot(override?: string): string | null {
  const root = override ?? process.env.TEXTTEXT_RELEASE_ARTIFACT_ROOT ?? DEFAULT_ARTIFACT_ROOT;
  if (!isAbsolute(root) || normalize(root) !== root || !root.endsWith("/release-artifacts")) return null;
  if (root.split("/").some((segment) => ["releases", "incoming", "current", "backups"].includes(segment))) return null;
  if (process.env.NODE_ENV === "production" && !/^\/home\/ubuntu\/[a-zA-Z0-9/_-]+\/release-artifacts$/.test(root)) return null;
  return root;
}

export function parseReleaseRange(value: string, size: number): ByteRange | null {
  const match = value.match(SINGLE_BYTE_RANGE);
  if (!match || (!match[1] && !match[2])) return null;
  if (match[1]) {
    const start = Number(match[1]);
    const requestedEnd = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) return null;
    return { start, end: Math.min(requestedEnd, size - 1) };
  }
  const suffix = Number(match[2]);
  if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
  return { start: Math.max(0, size - suffix), end: size - 1 };
}

function errorResponse(status: 404 | 416 | 503, size?: number): Response {
  const headers = new Headers({
    "Cache-Control": NO_STORE,
    "X-Content-Type-Options": "nosniff",
  });
  if (status === 416 && size !== undefined) headers.set("Content-Range", `bytes */${size}`);
  return new Response(null, { status, headers });
}

function responseHeaders(artifact: ReleaseArtifact, length: number): Headers {
  const headers = new Headers({
    "Content-Type": artifact.contentType,
    "Content-Disposition": `${artifact.ranges ? "attachment" : "inline"}; filename="${artifact.filename}"`,
    "Content-Length": String(length),
    "Cache-Control": IMMUTABLE_CACHE,
    "X-Content-Type-Options": "nosniff",
  });
  if (artifact.ranges) headers.set("Accept-Ranges", "bytes");
  return headers;
}

function missingFile(error: unknown): boolean {
  return ["ENOENT", "ENOTDIR", "ELOOP"].includes((error as { code?: string })?.code ?? "");
}

/** Serve one immutable local artifact. The route is useful before the directory exists. */
export async function serveReleaseDownload(
  filename: string,
  options: { method: "GET" | "HEAD"; range?: string | null; root?: string },
): Promise<Response> {
  const artifact = releaseArtifactForFilename(filename);
  if (!artifact) return errorResponse(404);
  const root = artifactRoot(options.root);
  if (!root) return errorResponse(503);

  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let streamOwnsHandle = false;
  try {
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return errorResponse(404);
    const artifactPath = join(
      /* turbopackIgnore: true */ root,
      artifact.filename,
    );
    handle = await open(
      /* turbopackIgnore: true */ artifactPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const info = await handle.stat();
    if (!info.isFile() || info.size <= 0 || (!artifact.ranges && info.size > MAX_APPCAST_BYTES)) return errorResponse(404);

    const requestedRange = options.method === "GET" ? options.range?.trim() || null : null;
    let range: ByteRange | undefined;
    if (requestedRange) {
      if (!artifact.ranges) return errorResponse(416, info.size);
      range = parseReleaseRange(requestedRange, info.size) ?? undefined;
      if (!range) return errorResponse(416, info.size);
    }
    const length = range ? range.end - range.start + 1 : info.size;
    const headers = responseHeaders(artifact, length);
    if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`);
    if (options.method === "HEAD") return new Response(null, { status: 200, headers });

    const stream = handle.createReadStream({
      autoClose: true,
      start: range?.start,
      end: range?.end,
    });
    const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
    const response = new Response(body, { status: range ? 206 : 200, headers });
    streamOwnsHandle = true;
    return response;
  } catch (error) {
    return errorResponse(missingFile(error) ? 404 : 503);
  } finally {
    if (handle && !streamOwnsHandle) await handle.close().catch(() => {});
  }
}
