import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

const PREFIX = "media/v1/";
const MAX_BYTES = 50 * 1024 * 1024;
export function isMediaStorageConfigured(): boolean {
  return Boolean(process.env.R2_MEDIA_ACCOUNT_ID || process.env.TEXTTEXT_R2_ACCOUNT_ID) && ["R2_MEDIA_ACCESS_KEY_ID", "R2_MEDIA_SECRET_ACCESS_KEY", "MEDIA_ORIGIN"].every(name => Boolean(process.env[name]));
}
function configuration() {
  if (!isMediaStorageConfigured()) throw new Error("Document asset storage is not configured.");
  const account = process.env.R2_MEDIA_ACCOUNT_ID || process.env.TEXTTEXT_R2_ACCOUNT_ID!;
  if (!/^[a-f0-9]{32}$/.test(account)) throw new Error("Invalid media storage account configuration.");
  const origin = new URL(process.env.MEDIA_ORIGIN!);
  if ((origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname))) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Invalid media origin configuration.");
  return { origin: origin.origin, bucket: process.env.R2_MEDIA_BUCKET || "texttext-media", client: new S3Client({ region: "auto", endpoint: `https://${account}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_MEDIA_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_MEDIA_SECRET_ACCESS_KEY! }, maxAttempts: 3 }) };
}
export function validMediaKey(key: string): boolean {
  return key.length <= 1024 && /^(?:documents|captures)\/[a-z0-9-]+\/|^editor\/media\/[a-z0-9-]+\//.test(key) && key.split("/").every(segment => /^[a-zA-Z0-9._-]+$/.test(segment) && segment !== "." && segment !== "..");
}
export function mediaUrl(key: string): string {
  if (!validMediaKey(key)) throw new Error("Invalid media path.");
  const origin = new URL(process.env.MEDIA_ORIGIN!).origin;
  return `${origin}/api/media/${key.split("/").map(encodeURIComponent).join("/")}`;
}
export function mediaKeyFromUrl(value: string): string | null {
  try {
    const url = new URL(value), origin = new URL(process.env.MEDIA_ORIGIN!);
    if (url.origin !== origin.origin || url.search || url.hash || !url.pathname.startsWith("/api/media/")) return null;
    const key = decodeURIComponent(url.pathname.slice("/api/media/".length));
    return validMediaKey(key) && mediaUrl(key) === url.toString() ? key : null;
  } catch { return null; }
}
export async function put(pathname: string, body: Blob | Uint8Array, options: { contentType: string }) {
  if (!validMediaKey(pathname)) throw new Error("Invalid media path.");
  if (!/^(?:image|video)\/[a-z0-9!#$&^_.+-]+$/i.test(options.contentType)) throw new Error("Invalid media content type.");
  const size = body instanceof Blob ? body.size : body.byteLength;
  if (!size || size > MAX_BYTES) throw new Error("Media must be between 1 byte and 50 MB.");
  const slash = pathname.lastIndexOf("/"), key = `${pathname.slice(0, slash + 1)}${randomUUID()}-${pathname.slice(slash + 1)}`;
  const { client, bucket } = configuration();
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: PREFIX + key, Body: body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : body, ContentType: options.contentType, ContentLength: size, IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(60_000) });
    return { url: mediaUrl(key), pathname: key, contentType: options.contentType };
  } finally { client.destroy(); }
}
export async function del(urls: string | string[]): Promise<void> {
  const keys = [...new Set((Array.isArray(urls) ? urls : [urls]).map(mediaKeyFromUrl).filter((key): key is string => Boolean(key)))];
  if (!keys.length) return; // Legacy disposable Blob URLs and unrelated origins are never followed.
  const { client, bucket } = configuration();
  try {
    for (let offset = 0; offset < keys.length; offset += 100) {
      const result = await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.slice(offset, offset + 100).map(key => ({ Key: PREFIX + key })), Quiet: true } }), { abortSignal: AbortSignal.timeout(30_000) });
      if (result.Errors?.length) throw new Error("Some media objects could not be deleted.");
    }
  } finally { client.destroy(); }
}
export async function list(options: { prefix: string; cursor?: string }) {
  if (!options.prefix.endsWith("/") || !validMediaKey(`${options.prefix}probe`)) throw new Error("Invalid media prefix.");
  const { client, bucket } = configuration();
  try {
    const result = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX + options.prefix, ContinuationToken: options.cursor, MaxKeys: 100 }), { abortSignal: AbortSignal.timeout(30_000) });
    if (result.IsTruncated && (!result.NextContinuationToken || result.NextContinuationToken === options.cursor)) throw new Error("Invalid media listing cursor.");
    return { blobs: (result.Contents ?? []).flatMap(entry => { const key = entry.Key?.slice(PREFIX.length); return entry.Key?.startsWith(PREFIX + options.prefix) && key && validMediaKey(key) ? [{ pathname: key, url: mediaUrl(key) }] : []; }), hasMore: result.IsTruncated === true, cursor: result.NextContinuationToken };
  } finally { client.destroy(); }
}
/** Caller must authorize before invoking this function. Never cache private media at the CDN. */
export async function readMedia(key: string, range: string | null): Promise<Response> {
  if (!validMediaKey(key)) return new Response(null, { status: 404 });
  if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return new Response(null, { status: 416 });
  const { client, bucket } = configuration();
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: PREFIX + key, ...(range ? { Range: range } : {}) }), { abortSignal: AbortSignal.timeout(60_000) });
    if (!result.Body) { client.destroy(); return new Response(null, { status: 404 }); }
    const headers = new Headers({ "Content-Type": result.ContentType ?? "application/octet-stream", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Accept-Ranges": "bytes" });
    if (result.ContentLength !== undefined) headers.set("Content-Length", String(result.ContentLength));
    if (result.ContentRange) headers.set("Content-Range", result.ContentRange);
    const reader = result.Body.transformToWebStream().getReader();
    const body = new ReadableStream({ async pull(controller) { try { const next = await reader.read(); if (next.done) { controller.close(); client.destroy(); } else controller.enqueue(next.value); } catch (error) { controller.error(error); client.destroy(); } }, async cancel(reason) { try { await reader.cancel(reason); } finally { client.destroy(); } } });
    return new Response(body, { status: result.ContentRange ? 206 : 200, headers });
  } catch (error) {
    client.destroy();
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || status === 416) return new Response(null, { status, headers: { "Cache-Control": "private, no-store" } });
    throw error;
  }
}
