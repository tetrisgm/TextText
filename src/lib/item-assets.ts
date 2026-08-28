import { hostResolvesToPublicOnly, isFetchableBookmarkUrl } from "@/lib/bookmark-fetch";
import type { Post } from "@/lib/content";
import { isNoCoverValue } from "@/lib/cover";

const MAX_ASSET_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECT_HOPS = 5;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_FILENAME_LENGTH = 240;

type ItemAssetRole =
  | "cover"
  | "body"
  | "gallery"
  | "gallery_poster"
  | "video"
  | "capture"
  | "screenshot";

type ItemAssetReference = {
  url: string;
  role: ItemAssetRole;
  contentType?: string;
  filename?: string;
  originalUrl?: string;
  caption?: string;
  altText?: string;
};

type ImportedItemAsset = {
  url: string;
  contentType: string;
  filename: string;
  sourceUrl: string;
  bytes: number;
};

type ItemAssetPlacement = "cover" | "body_end" | "gallery";

function normalizedMediaContentType(value: string): string | null {
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return /^(?:image|video)\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(normalized)
    ? normalized
    : null;
}

function filenameFromPath(value: string): string {
  const encoded = value.split(/[\\/]/).filter(Boolean).pop() ?? "";
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function fileExtension(filename: string): string | undefined {
  return filename.toLowerCase().match(/\.([a-z0-9]{1,10})$/)?.[1];
}

function extensionForContentType(contentType: string): string | undefined {
  switch (contentType) {
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    case "image/avif": return "avif";
    case "image/svg+xml": return "svg";
    case "image/heic": return "heic";
    case "image/heif": return "heif";
    case "image/tiff": return "tiff";
    case "video/mp4": return "mp4";
    case "video/quicktime": return "mov";
    case "video/webm": return "webm";
    case "video/mpeg": return "mpg";
    case "video/x-m4v": return "m4v";
    case "video/ogg": return "ogv";
    default: return undefined;
  }
}

function safeAssetFilename(value: string, contentType: string): string {
  const source = filenameFromPath(value);
  const sourceExtension = fileExtension(source);
  const extension = extensionForContentType(contentType) ?? sourceExtension ?? "bin";
  const withoutExtension = sourceExtension
    ? source.slice(0, -(sourceExtension.length + 1))
    : source;
  let stem = withoutExtension
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!stem) stem = "asset";
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) {
    stem = `asset-${stem}`;
  }
  stem = stem.slice(0, Math.max(1, MAX_FILENAME_LENGTH - extension.length - 1));
  return `${stem}.${extension}`;
}

function cleanMarkdownAssetUrl(value: string): string | null {
  const candidate = value.trim().replace(/^<|>$/g, "");
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function listItemAssetReferences(post: Post): ItemAssetReference[] {
  const references: ItemAssetReference[] = [];
  const seen = new Set<string>();
  const add = (reference: ItemAssetReference) => {
    const key = `${reference.role}:${reference.url}`;
    if (!reference.url || seen.has(key)) return;
    seen.add(key);
    references.push(reference);
  };

  if (post.cover && !isNoCoverValue(post.cover)) {
    add({ url: post.cover, role: "cover", caption: post.coverCaption });
  }

  const markdownImage = /!\[([^\]]*)\]\((<?[^)\s>]+>?)(?:\s+["'][^"']*["'])?\)/g;
  for (const match of post.body.matchAll(markdownImage)) {
    const url = cleanMarkdownAssetUrl(match[2] ?? "");
    if (url) add({ url, role: "body", altText: match[1] || undefined });
  }

  for (const item of post.gallery ?? []) {
    add({ url: item.src, role: "gallery", caption: item.caption });
    if (item.poster) add({ url: item.poster, role: "gallery_poster" });
  }
  if (post.videoUrl) add({ url: post.videoUrl, role: "video" });

  for (const asset of post.capture?.assets ?? []) {
    add({
      url: asset.url,
      role: "capture",
      contentType: asset.contentType,
      filename: asset.filename,
      originalUrl: asset.originalUrl,
    });
  }
  if (post.capture?.screenshotUrl) {
    add({ url: post.capture.screenshotUrl, role: "screenshot" });
  }
  for (const tile of post.capture?.screenshotTiles ?? []) {
    add({ url: tile.url, role: "screenshot" });
  }

  return references;
}

async function fetchPublicMedia(sourceUrl: string): Promise<{
  response: Response;
  finalUrl: URL;
}> {
  let current = new URL(sourceUrl);
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    if (!isFetchableBookmarkUrl(current)) {
      throw new Error("Asset URL must be a public HTTP or HTTPS address.");
    }
    if (!(await hostResolvesToPublicOnly(current.hostname))) {
      throw new Error("Asset host does not resolve to a public address.");
    }
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        accept: "image/*,video/*",
        "user-agent": "texttext-asset-import/1",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Asset redirect did not include a destination.");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`Asset server returned HTTP ${response.status}.`);
    return { response, finalUrl: current };
  }
  throw new Error("Asset URL redirected too many times.");
}

export async function importItemAssetFromUrl(input: {
  handle: string;
  itemId: string;
  sourceUrl: string;
  media?: "image" | "image-or-video";
}): Promise<ImportedItemAsset> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("Document asset storage is not configured.");

  const { response, finalUrl } = await fetchPublicMedia(input.sourceUrl);
  const contentType = normalizedMediaContentType(response.headers.get("content-type") ?? "");
  if (!contentType) throw new Error("Only images and videos can be imported.");
  if (input.media === "image" && !contentType.startsWith("image/")) {
    throw new Error("A cover must be an image.");
  }
  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_ASSET_BYTES) {
    throw new Error("Asset must be 50 MB or smaller.");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error("Asset must not be empty.");
  if (bytes.byteLength > MAX_ASSET_BYTES) throw new Error("Asset must be 50 MB or smaller.");

  const filename = safeAssetFilename(finalUrl.pathname, contentType);
  const pathname = `documents/${input.handle}/${input.itemId}/assets/${filename}`;
  const { put } = await import("@vercel/blob");
  const blob = await put(pathname, Buffer.from(bytes), {
    access: "public",
    addRandomSuffix: true,
    allowOverwrite: false,
    contentType,
    token,
  });
  return {
    url: blob.url,
    contentType: normalizedMediaContentType(blob.contentType) ?? contentType,
    filename: safeAssetFilename(filenameFromPath(blob.pathname), contentType),
    sourceUrl: finalUrl.toString(),
    bytes: bytes.byteLength,
  };
}

function markdownAttachment(
  asset: ImportedItemAsset,
  altText?: string,
  caption?: string,
): string {
  return asset.contentType.startsWith("image/")
    ? `![${altText ?? ""}](${asset.url})`
    : `[${caption ?? asset.filename}](${asset.url})`;
}

export function attachItemAsset(
  post: Post,
  asset: ImportedItemAsset,
  placement: ItemAssetPlacement,
  options: { altText?: string; caption?: string } = {},
): Post {
  const attachment = markdownAttachment(asset, options.altText, options.caption);
  return {
    ...post,
    ...(placement === "cover"
      ? { cover: asset.url, coverCaption: options.caption }
      : {}),
    ...(placement === "body_end"
      ? {
          body: post.body.trimEnd()
            ? `${post.body.trimEnd()}\n\n${attachment}`
            : attachment,
        }
      : {}),
    ...(placement === "gallery"
      ? {
          gallery: [
            ...(post.gallery ?? []),
            { src: asset.url, caption: options.caption },
          ],
        }
      : {}),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function removeItemAssetReferences(
  post: Post,
  assetUrl: string,
): { changed: boolean; post: Post } {
  const escaped = escapeRegExp(assetUrl);
  const targetPattern = `\\s*<?${escaped}>?(?:\\s+["'][^)]*["'])?\\s*`;
  const replacedBody = post.body
    .replace(new RegExp(`!\\[[^\\]]*\\]\\(${targetPattern}\\)`, "g"), "")
    .replace(new RegExp(`\\[[^\\]]+\\]\\(${targetPattern}\\)`, "g"), "")
    .replace(new RegExp(`^\\s*${escaped}\\s*$`, "gm"), "");
  const body = replacedBody === post.body
    ? post.body
    : replacedBody.replace(/\n{3,}/g, "\n\n").trim();
  const gallery = post.gallery
    ?.filter((entry) => entry.src !== assetUrl)
    .map((entry) =>
      entry.poster === assetUrl ? { ...entry, poster: undefined } : entry,
    );
  const next: Post = {
    ...post,
    cover: post.cover === assetUrl ? undefined : post.cover,
    body,
    gallery,
    videoUrl: post.videoUrl === assetUrl ? undefined : post.videoUrl,
  };
  const changed =
    next.cover !== post.cover ||
    next.body !== post.body ||
    next.videoUrl !== post.videoUrl ||
    JSON.stringify(next.gallery ?? []) !== JSON.stringify(post.gallery ?? []);
  return {
    changed,
    post: changed ? next : post,
  };
}
