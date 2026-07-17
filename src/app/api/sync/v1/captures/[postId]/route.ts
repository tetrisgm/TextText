// Capture result upload (multipart/form-data):
//
//   PUT /api/sync/v1/captures/{postId}
//     meta       JSON string: {url, title?, siteName?, description?,
//                capturedBy?, error?} (error marks the capture failed)
//     readable   optional text field: readable extraction as markdown; lands
//                in the post body only when the body is empty
//     screenshot     optional image file -> Blob
//     assetManifest  optional JSON [{field, originalUrl, filename?, contentType?}]
//     asset files    optional image files named by assetManifest.field -> Blob
//
// -> {item: {id, slug, captureStatus}}. Artifacts go to Blob storage under a
// versioned captures/{handle}/{postId}/generations/{generation}/ prefix; their
// URLs become visible together only when that generation finalizes.

import type { BookmarkCapture } from "@/lib/content";
import { remoteMarkdownImageUrls } from "@/lib/bookmark-capture-generation";
import { fetchPublicResource } from "@/lib/bookmark-fetch";
import { recordAction } from "@/lib/audit";
import { resolveItemAccess } from "@/lib/permissions";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import {
  getPostById,
  legacyBookmarkHtmlUrl,
  markCapturePending,
  prepareBookmarkCaptureGeneration,
  saveBookmarkCaptureGeneration,
} from "@/lib/store";
import { resolveSyncWorkspace } from "../../auth";
import { syncError } from "../../sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024;
const MAX_ASSET_BYTES = 3 * 1024 * 1024;
const MAX_ASSETS_PER_UPLOAD = 4;
const MAX_READABLE_ASSETS_PER_CAPTURE = 200;
// The readable extraction becomes the post body; a real article is well
// under this. Cap it so an oversized text field cannot bloat the row or the
// markdown round-trip.
const MAX_READABLE_BYTES = 2 * 1024 * 1024;

async function deleteLegacyBookmarkHtmlBlob(
  htmlUrl: string | undefined,
  token: string | undefined = process.env.BLOB_READ_WRITE_TOKEN,
): Promise<void> {
  if (!htmlUrl) return;
  if (!token) {
    console.warn(
      "legacy bookmark HTML blob not deleted: BLOB_READ_WRITE_TOKEN is not configured",
    );
    return;
  }
  try {
    const { del } = await import("@vercel/blob");
    await del(htmlUrl, { token });
  } catch (error) {
    console.warn("legacy bookmark HTML blob deletion failed", error);
  }
}

function formFile(form: FormData, name: string): File | null {
  const value = form.get(name);
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as File).arrayBuffer === "function" &&
    (value as File).size > 0
  ) {
    return value as File;
  }
  return null;
}

function formatBytes(bytes: number): string {
  return `${Math.ceil(bytes / (1024 * 1024))} MB`;
}

function oversizedFileError(
  file: File | null,
  label: string,
  limit: number,
): string | null {
  if (!file || file.size <= limit) return null;
  return `${label} artifact is ${formatBytes(file.size)}; limit is ${formatBytes(limit)}`;
}

function oversizedReadableError(readable: string | undefined): string | null {
  if (!readable) return null;
  const size = Buffer.byteLength(readable);
  if (size <= MAX_READABLE_BYTES) return null;
  return `Readable extraction is ${formatBytes(size)}; limit is ${formatBytes(MAX_READABLE_BYTES)}`;
}

function fileType(file: File, fallback: string): string {
  return typeof file.type === "string" && file.type.trim()
    ? file.type
    : fallback;
}

function screenshotContentType(file: File): string {
  const type = fileType(file, "image/png").toLowerCase().split(";")[0];
  if (type === "image/webp") return "image/webp";
  if (type === "image/jpeg") return "image/jpeg";
  return "image/png";
}

function screenshotFilename(contentType: string): string {
  if (contentType === "image/webp") return "screenshot.webp";
  if (contentType === "image/jpeg") return "screenshot.jpg";
  return "screenshot.png";
}

function assetContentType(file: File, fallback: string | undefined): string {
  const type = fileType(file, fallback || "application/octet-stream")
    .toLowerCase()
    .split(";")[0];
  if (type === "image/avif") return "image/avif";
  if (type === "image/gif") return "image/gif";
  if (type === "image/jpeg") return "image/jpeg";
  if (type === "image/png") return "image/png";
  if (type === "image/webp") return "image/webp";
  return "application/octet-stream";
}

function isAllowedAssetContentType(type: string): boolean {
  return type.startsWith("image/");
}

function assetExtension(contentType: string): string {
  if (contentType === "image/avif") return "avif";
  if (contentType === "image/gif") return "gif";
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

function normalizedImageContentType(
  contentType: string | null | undefined,
  sourceUrl: string,
): string | null {
  const type = (contentType ?? "").toLowerCase().split(";")[0].trim();
  if (isAllowedAssetContentType(type)) return assetContentTypeFromString(type);
  let pathname = "";
  try {
    pathname = new URL(sourceUrl).pathname.toLowerCase();
  } catch {
    pathname = sourceUrl.toLowerCase();
  }
  if (pathname.endsWith(".avif")) return "image/avif";
  if (pathname.endsWith(".gif")) return "image/gif";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  return null;
}

function assetContentTypeFromString(type: string): string | null {
  if (type === "image/avif") return "image/avif";
  if (type === "image/gif") return "image/gif";
  if (type === "image/jpeg") return "image/jpeg";
  if (type === "image/png") return "image/png";
  if (type === "image/webp") return "image/webp";
  return null;
}

function safeAssetStem(value: string, fallback: string): string {
  const trimmed = value.trim().toLowerCase();
  const stem = trimmed
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return stem || fallback;
}

function assetDownloadCandidates(sourceUrl: string): string[] {
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== "http:") return [sourceUrl];
    url.protocol = "https:";
    return [url.href, sourceUrl];
  } catch {
    return [sourceUrl];
  }
}

function readableAssetFilename(sourceUrl: string, index: number, contentType: string): string {
  let sourceName = `image-${index + 1}`;
  try {
    const url = new URL(sourceUrl);
    sourceName = url.pathname.split("/").filter(Boolean).pop() || sourceName;
  } catch {
    sourceName = sourceUrl.split("/").filter(Boolean).pop() || sourceName;
  }
  const stem = safeAssetStem(sourceName, `image-${index + 1}`);
  return `${stem}.${assetExtension(contentType)}`;
}

async function fetchReadableAsset(
  sourceUrl: string,
  index: number,
): Promise<{ data: ArrayBuffer; contentType: string; filename: string } | null> {
  for (const candidate of assetDownloadCandidates(sourceUrl)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetchPublicResource(candidate, {
        headers: { Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
        signal: controller.signal,
      });
      if (!response) continue;
      if (!response.ok) continue;
      const contentLength = Number(response.headers.get("content-length") ?? "0");
      if (contentLength > MAX_ASSET_BYTES) continue;
      const contentType = normalizedImageContentType(
        response.headers.get("content-type"),
        candidate,
      );
      if (!contentType) continue;
      const data = await response.arrayBuffer();
      if (data.byteLength === 0 || data.byteLength > MAX_ASSET_BYTES) continue;
      return {
        data,
        contentType,
        filename: readableAssetFilename(sourceUrl, index, contentType),
      };
    } catch {
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

type AssetManifestEntry = {
  field: string;
  originalUrl: string;
  filename?: string;
  contentType?: string;
};

function parseAssetManifest(value: FormDataEntryValue | null):
  | { entries: AssetManifestEntry[]; error?: never }
  | { entries?: never; error: string } {
  if (value == null) return { entries: [] };
  if (typeof value !== "string") return { error: "assetManifest must be JSON" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { error: "assetManifest must be JSON" };
  }
  if (!Array.isArray(parsed)) return { error: "assetManifest must be a list" };
  if (parsed.length > MAX_ASSETS_PER_UPLOAD) {
    return { error: `Upload at most ${MAX_ASSETS_PER_UPLOAD} assets at a time` };
  }
  const entries: AssetManifestEntry[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      return { error: "assetManifest entries must be objects" };
    }
    const record = item as Record<string, unknown>;
    const field = typeof record.field === "string" ? record.field.trim() : "";
    const originalUrl =
      typeof record.originalUrl === "string" ? record.originalUrl.trim() : "";
    if (!field || !/^[a-zA-Z0-9_-]{1,40}$/.test(field)) {
      return { error: "assetManifest entries need a safe field name" };
    }
    if (!originalUrl || !/^https?:\/\//i.test(originalUrl)) {
      return { error: "assetManifest entries need an http originalUrl" };
    }
    const filename =
      typeof record.filename === "string" ? record.filename.trim() : undefined;
    const contentType =
      typeof record.contentType === "string"
        ? record.contentType.trim()
        : undefined;
    entries.push({ field, originalUrl, filename, contentType });
  }
  return { entries };
}

function metaString(
  meta: Record<string, unknown>,
  key: "title" | "siteName" | "description" | "capturedBy" | "generation",
): string | undefined {
  const value = meta[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function generationErrorStatus(
  reason: "missing" | "stale" | "invalid" | "incomplete" | "conflict",
): number {
  if (reason === "missing") return 404;
  if (reason === "invalid") return 400;
  if (reason === "incomplete") return 422;
  return 409;
}

function captureArtifactUrls(capture: BookmarkCapture | undefined): string[] {
  return [
    ...(capture?.assets ?? []).map((asset) => asset.url),
    ...(capture?.screenshotTiles ?? []).map((tile) => tile.url),
    capture?.screenshotUrl,
  ].filter((url): url is string => Boolean(url?.trim()));
}

async function deleteSupersededCaptureArtifacts(
  previous: BookmarkCapture | undefined,
  next: BookmarkCapture | undefined,
  token: string | undefined,
): Promise<void> {
  if (!token) return;
  const retained = new Set(captureArtifactUrls(next));
  const obsolete = [...new Set(captureArtifactUrls(previous))].filter(
    (url) => !retained.has(url),
  );
  if (obsolete.length === 0) return;
  try {
    const { del } = await import("@vercel/blob");
    await del(obsolete, { token });
  } catch (error) {
    console.warn("superseded bookmark capture artifact deletion failed", error);
  }
}

function metaNonNegativeInteger(
  meta: Record<string, unknown>,
  key: "screenshotIndex" | "screenshotCount",
): number | undefined {
  const value = meta[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ postId: string }> },
) {
  const workspace = await resolveSyncWorkspace(request);
  if (workspace instanceof Response) return workspace;
  const { blog, userId } = workspace;
  const { postId } = await ctx.params;
  const access = await resolveItemAccess({ handle: blog.handle, postId, user: workspace });
  if (!access.isOwner) {
    return syncError(403, "Only the owner can upload captures");
  }
  const existingPost = await getPostById(blog.handle, postId);
  if (!existingPost || existingPost.type !== "bookmark") {
    return syncError(404, "Bookmark not found");
  }
  const legacyHtmlUrl = legacyBookmarkHtmlUrl(existingPost.capture);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return syncError(400, "Send multipart/form-data");
  }

  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(String(form.get("meta") ?? "{}"));
  } catch {
    return syncError(400, "meta must be JSON");
  }
  const url = typeof meta.url === "string" ? meta.url : "";
  if (!url) return syncError(400, "meta.url is required");
  const requestedGeneration = metaString(meta, "generation");
  if (
    requestedGeneration &&
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(requestedGeneration)
  ) {
    return syncError(400, "meta.generation is invalid");
  }
  const preparedGeneration = await prepareBookmarkCaptureGeneration(
    blog.handle,
    postId,
    { requestedGeneration, url },
  );
  if (!preparedGeneration.ok) {
    return syncError(
      generationErrorStatus(preparedGeneration.reason),
      preparedGeneration.message,
    );
  }
  const generationId = preparedGeneration.generation.id;
  const metaError = typeof meta.error === "string" && meta.error ? meta.error : null;

  const screenshot = formFile(form, "screenshot");
  const screenshotIndex = metaNonNegativeInteger(meta, "screenshotIndex");
  const screenshotCount = metaNonNegativeInteger(meta, "screenshotCount");
  if (
    screenshot &&
    ((screenshotIndex === undefined) !== (screenshotCount === undefined) ||
      (screenshotIndex !== undefined &&
        screenshotCount !== undefined &&
        (screenshotCount < 1 || screenshotIndex >= screenshotCount)))
  ) {
    return syncError(400, "Screenshot tile metadata is invalid");
  }
  const assetManifest = parseAssetManifest(form.get("assetManifest"));
  if (assetManifest.error) return syncError(400, assetManifest.error);
  const readableValue = form.get("readable");
  const readableMarkdown =
    typeof readableValue === "string" ? readableValue : undefined;
  const readableAssetUrls = remoteMarkdownImageUrls(readableMarkdown);
  if (readableAssetUrls.length > MAX_READABLE_ASSETS_PER_CAPTURE) {
    return syncError(
      413,
      `Readable capture has ${readableAssetUrls.length} images; limit is ${MAX_READABLE_ASSETS_PER_CAPTURE}`,
    );
  }
  const assetFiles = (assetManifest.entries ?? []).map((entry) => ({
    entry,
    file: formFile(form, entry.field),
  }));
  const missingAsset = assetFiles.find(({ file }) => !file);
  const assetFileError = missingAsset
    ? `Missing asset file ${missingAsset.entry.field}`
    : null;
  const assetSizeError =
    assetFiles
      .map(({ file, entry }) =>
        oversizedFileError(file, `Asset ${entry.field}`, MAX_ASSET_BYTES),
      )
      .find(Boolean) ?? null;
  const assetTypeError =
    assetFiles
      .map(({ file, entry }) => {
        if (!file) return null;
        const type = assetContentType(file, entry.contentType);
        return isAllowedAssetContentType(type)
          ? null
          : `Asset ${entry.field} must be an image`;
      })
      .find(Boolean) ?? null;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  const storageError =
    !blobToken && (assetFiles.length > 0 || readableAssetUrls.length > 0)
      ? "Bookmark asset storage is not configured"
      : null;
  if (assetFileError) return syncError(400, assetFileError);
  if (assetSizeError) return syncError(413, assetSizeError);
  if (assetTypeError) return syncError(400, assetTypeError);
  if (storageError) return syncError(503, storageError);
  const error =
    metaError ??
    oversizedFileError(screenshot, "Screenshot", MAX_SCREENSHOT_BYTES) ??
    oversizedReadableError(readableMarkdown);

  const capture: BookmarkCapture = {
    url,
    capturedAt: new Date().toISOString(),
    capturedBy: metaString(meta, "capturedBy") ?? "agent",
    assets: preparedGeneration.generation.capture.assets,
    screenshotTiles: preparedGeneration.generation.capture.screenshotTiles,
    screenshotUrl: preparedGeneration.generation.capture.screenshotUrl,
  };
  const title = metaString(meta, "title");
  const siteName = metaString(meta, "siteName");
  const description = metaString(meta, "description");
  if (title) capture.title = title;
  if (siteName) capture.siteName = siteName;
  if (description) capture.description = description;
  if (error) capture.error = error;

  // Artifacts only for successful captures; a failure report is metadata-only.
  if (!error && blobToken) {
    if (
      screenshot ||
      assetFiles.length > 0 ||
      readableAssetUrls.length > 0
    ) {
      const { put } = await import("@vercel/blob");
      for (const { entry, file } of assetFiles) {
        if (!file) continue;
        const contentType = assetContentType(file, entry.contentType);
        const sourceName = entry.filename || file.name || entry.field;
        const stem = safeAssetStem(sourceName, entry.field);
        const blob = await put(
          `captures/${blog.handle}/${postId}/generations/${generationId}/assets/${stem}.${assetExtension(contentType)}`,
          file,
          {
            access: "public",
            addRandomSuffix: true,
            contentType,
            token: blobToken,
          },
        );
        capture.assets = [
          ...(capture.assets ?? []),
          {
            originalUrl: entry.originalUrl,
            url: blob.url,
            contentType,
            filename: sourceName,
          },
        ];
      }
      const savedOriginalUrls = new Set(
        (capture.assets ?? []).map((asset) => asset.originalUrl),
      );
      for (
        let offset = 0;
        offset < readableAssetUrls.length;
        offset += MAX_ASSETS_PER_UPLOAD
      ) {
        const batch = readableAssetUrls.slice(offset, offset + MAX_ASSETS_PER_UPLOAD);
        const downloaded = await Promise.all(
          batch.map(async (originalUrl, index) => ({
            originalUrl,
            asset: savedOriginalUrls.has(originalUrl)
              ? null
              : await fetchReadableAsset(originalUrl, offset + index),
            index: offset + index,
          })),
        );
        for (const { originalUrl, asset, index } of downloaded) {
          if (!asset) continue;
          const blob = await put(
            `captures/${blog.handle}/${postId}/generations/${generationId}/assets/${safeAssetStem(
              asset.filename,
              `image-${index + 1}`,
            )}.${assetExtension(asset.contentType)}`,
            asset.data,
            {
              access: "public",
              addRandomSuffix: true,
              contentType: asset.contentType,
              token: blobToken,
            },
          );
          capture.assets = [
            ...(capture.assets ?? []),
            {
              originalUrl,
              url: blob.url,
              contentType: asset.contentType,
              filename: asset.filename,
            },
          ];
          savedOriginalUrls.add(originalUrl);
        }
      }
      const unresolvedReadableAssets = readableAssetUrls.filter(
        (originalUrl) => !savedOriginalUrls.has(originalUrl),
      );
      if (unresolvedReadableAssets.length > 0) {
        return syncError(
          503,
          `Could not save ${unresolvedReadableAssets.length} bookmark image${
            unresolvedReadableAssets.length === 1 ? "" : "s"
          } locally`,
        );
      }
      if (screenshot) {
        const contentType = screenshotContentType(screenshot);
        const tileSuffix =
          screenshotIndex !== undefined && screenshotCount !== undefined
            ? `-${String(screenshotIndex + 1).padStart(3, "0")}-of-${String(
                screenshotCount,
              ).padStart(3, "0")}`
            : "";
        const filename = screenshotFilename(contentType).replace(
          /(?=\.[^.]+$)/,
          tileSuffix,
        );
        const blob = await put(
          `captures/${blog.handle}/${postId}/generations/${generationId}/${filename}`,
          screenshot,
          {
            access: "public",
            addRandomSuffix: true,
            contentType,
            token: blobToken,
          },
        );
        if (screenshotIndex === undefined) {
          capture.screenshotUrl = blob.url;
        } else {
          capture.screenshotTiles = [
            ...(capture.screenshotTiles ?? []),
            { index: screenshotIndex, url: blob.url },
          ];
          if (screenshotIndex === 0) capture.screenshotUrl = blob.url;
        }
      }
    }
  }

  const usesFinalizationProtocol = typeof meta.isFinal === "boolean";
  const legacyAssetOnlyPartial =
    Boolean(capture.assets?.length) &&
    !readableMarkdown &&
    !screenshot;
  const saved = await saveBookmarkCaptureGeneration(
    blog.handle,
    postId,
    generationId,
    capture,
    {
      readableMarkdown: error ? undefined : readableMarkdown,
      failed: Boolean(error),
      screenshotCount,
      isFinal:
        !error &&
        (usesFinalizationProtocol
          ? meta.isFinal === true
          : !legacyAssetOnlyPartial),
    },
  );
  if (!saved.ok) {
    return syncError(generationErrorStatus(saved.reason), saved.message);
  }
  await deleteLegacyBookmarkHtmlBlob(legacyHtmlUrl);
  if (saved.finalized && !error) {
    await deleteSupersededCaptureArtifacts(
      existingPost.capture,
      saved.post.capture,
      blobToken,
    );
  }

  await recordAction({
    actorUserId: userId,
    actorType: "external_agent",
    actionName: "sync.capture_bookmark",
    targetType: "item",
    targetId: saved.post.id,
    inputSummary: url,
    outputSummary: error ? `failed: ${error}` : "captured",
  });
  revalidateBlogPaths(blog, [saved.post.slug]);
  return Response.json({
    item: {
      id: saved.post.id,
      slug: saved.post.slug,
      captureStatus: saved.post.captureStatus,
      generation: generationId,
      finalized: saved.finalized,
    },
  });
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ postId: string }> },
) {
  const workspace = await resolveSyncWorkspace(request);
  if (workspace instanceof Response) return workspace;
  const { blog, userId } = workspace;
  const { postId } = await ctx.params;
  const access = await resolveItemAccess({
    handle: blog.handle,
    postId,
    user: workspace,
  });
  if (!access.isOwner) {
    return syncError(403, "Only the owner can recapture bookmarks");
  }
  const post = await getPostById(blog.handle, postId);
  if (!post || post.type !== "bookmark") {
    return syncError(404, "Bookmark not found");
  }
  const legacyHtmlUrl = legacyBookmarkHtmlUrl(post.capture);
  const url = post.links?.[0]?.href?.trim() || post.capture?.url?.trim() || "";
  if (!/^https?:\/\//i.test(url)) {
    return syncError(400, "Bookmark has no capture URL");
  }
  const pending = await markCapturePending(blog.handle, postId, url);
  if (!pending) return syncError(404, "Bookmark not found");
  await deleteLegacyBookmarkHtmlBlob(legacyHtmlUrl);
  await recordAction({
    actorUserId: userId,
    actorType: "external_agent",
    actionName: "sync.recapture_bookmark",
    targetType: "item",
    targetId: postId,
    inputSummary: url,
  });
  revalidateBlogPaths(blog, [post.slug]);
  return Response.json({
    item: {
      id: pending.id,
      slug: pending.slug,
      captureStatus: pending.captureStatus,
    },
  });
}
