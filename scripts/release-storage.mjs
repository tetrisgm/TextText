import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";

export function releaseStorageConfig(env = process.env) {
  const account = env.TEXTTEXT_R2_ACCOUNT_ID;
  if (!/^[a-f0-9]{32}$/.test(account ?? "")) throw new Error("TEXTTEXT_R2_ACCOUNT_ID must be configured.");
  if (!env.TEXTTEXT_RELEASE_R2_ACCESS_KEY_ID || !env.TEXTTEXT_RELEASE_R2_SECRET_ACCESS_KEY) throw new Error("Separate release-bucket R2 credentials must be configured.");
  if (!env.TEXTTEXT_RELEASE_PUBLIC_BASE) throw new Error("Choose and configure TEXTTEXT_RELEASE_PUBLIC_BASE before releasing.");
  const base = new URL(env.TEXTTEXT_RELEASE_PUBLIC_BASE);
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash || /(?:\.blob\.vercel-storage\.com|\.r2\.cloudflarestorage\.com)$/i.test(base.hostname)) throw new Error("TEXTTEXT_RELEASE_PUBLIC_BASE must be the public HTTPS download origin.");
  const bucket = env.TEXTTEXT_RELEASE_R2_BUCKET || "texttext-releases";
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket === "texttext-media") throw new Error("Invalid dedicated release bucket.");
  return { base: base.origin, bucket, clientOptions: { region: "auto", endpoint: `https://${account}.r2.cloudflarestorage.com`, credentials: { accessKeyId: env.TEXTTEXT_RELEASE_R2_ACCESS_KEY_ID, secretAccessKey: env.TEXTTEXT_RELEASE_R2_SECRET_ACCESS_KEY }, maxAttempts: 3 } };
}
export function createReleaseClient(config) { return new S3Client(config.clientOptions); }
export async function inspectReleaseFile(file) {
  const info = await stat(file);
  if (!info.isFile() || info.size <= 0) throw new Error("Release artifact is missing or empty.");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { length: info.size, sha256: hash.digest("hex") };
}
/** Conditional creation supports retry only when the immutable object is byte-identical. */
export async function uploadReleaseFile(client, config, key, file, contentType, identity) {
  if (!/^downloads\/(?:TextText-[0-9.]+\.zip|appcast-[0-9.]+\.xml)$/.test(key)) throw new Error("Invalid immutable release key.");
  const body = createReadStream(file);
  try {
    await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentLength: identity.length, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable", IfNoneMatch: "*", Metadata: { sha256: identity.sha256 } }), { abortSignal: AbortSignal.timeout(600_000) });
  } catch (error) {
    if (error?.$metadata?.httpStatusCode !== 412) throw error;
    const existing = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }), { abortSignal: AbortSignal.timeout(30_000) });
    if (existing.ContentLength !== identity.length || existing.Metadata?.sha256 !== identity.sha256) throw new Error("An immutable release object already exists with different bytes. Choose a new version.");
  } finally { body.destroy(); }
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
  if (!response.ok || !response.body) throw new Error("Release object is not available at the configured public download origin.");
  const reader = response.body.getReader(), hash = createHash("sha256");
  let length = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.byteLength;
      if (length > identity.length) throw new Error("Public release object exceeds its expected size.");
      hash.update(next.value);
    }
    if (length !== identity.length || hash.digest("hex") !== identity.sha256) throw new Error("Public release object does not match the signed local artifact.");
  } finally { await reader.cancel().catch(() => {}); }
}
