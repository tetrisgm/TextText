import type { Post } from "@/lib/content";
import { remoteMarkdownImageUrls } from "@/lib/markdown-images";
import { resolveItemAccess } from "@/lib/permissions";
import { getPostById } from "@/lib/store";
import { resolveSyncWorkspace } from "../../../auth";
import {
  isUuid,
  renderSyncDocumentFile,
  renderSyncFile,
  syncError,
} from "../../../sync";

interface Props {
  params: Promise<{ postId: string }>;
}

type Artifact = {
  filename: string;
  role: "asset";
  url: string;
  originalURL?: string;
  contentType?: string;
};

type ArtifactCandidate = {
  url: string;
  sourceFilename?: string;
  originalURL?: string;
  contentType?: string;
};

const MAX_ARTIFACT_FILENAME_LENGTH = 240;

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: Props) {
  const workspace = await resolveSyncWorkspace(request);
  if (workspace instanceof Response) return workspace;

  const { postId } = await params;
  if (!isUuid(postId)) return syncError(404, "Post not found");
  const post = await getPostById(workspace.blog.handle, postId);
  if (!post) return syncError(404, "Post not found");
  const access = await resolveItemAccess({
    handle: workspace.blog.handle,
    postId,
    user: workspace,
  });
  if (!access.canView) return syncError(404, "Post not found");

  return Response.json(
    {
      postId,
      slug: post.slug,
      fileHash: renderSyncFile(workspace.blog, post).hash,
      documentHash: renderSyncDocumentFile(workspace.blog, post).hash,
      artifacts: inlineArtifacts(post, workspace.blog.handle, postId),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

function inlineArtifacts(post: Post, handle: string, postId: string): Artifact[] {
  const screenshotURLs = new Set(
    [
      post.capture?.screenshotUrl,
      ...(post.capture?.screenshotTiles ?? []).map((tile) => tile.url),
    ].filter((url): url is string => Boolean(url)),
  );
  const candidates: ArtifactCandidate[] = [];
  const byURL = new Map<string, ArtifactCandidate>();

  const addCandidate = (candidate: ArtifactCandidate) => {
    const url = candidate.url.trim();
    if (
      !url ||
      screenshotURLs.has(url) ||
      !isWriteHostedAssetURL(url, handle, postId)
    ) {
      return;
    }

    const existing = byURL.get(url);
    if (existing) {
      existing.sourceFilename ??= candidate.sourceFilename;
      existing.originalURL ??= candidate.originalURL;
      existing.contentType ??= candidate.contentType;
      return;
    }

    const accepted = { ...candidate, url };
    byURL.set(url, accepted);
    candidates.push(accepted);
  };

  for (const url of remoteMarkdownImageUrls(post.body)) {
    addCandidate({ url });
  }
  for (const asset of post.capture?.assets ?? []) {
    addCandidate({
      url: asset.url,
      sourceFilename: asset.filename?.trim() || undefined,
      originalURL: asset.originalUrl?.trim() || undefined,
      contentType: normalizedMediaContentType(asset.contentType),
    });
  }
  for (const asset of post.document?.content.assets ?? []) {
    addCandidate({
      url: asset.src,
      contentType: asset.contentType,
    });
  }
  const documentCover = post.document?.content.fields.cover;
  if (typeof documentCover === "string") {
    addCandidate({ url: documentCover });
  }

  const usedFilenames = new Set<string>();
  return candidates.map((candidate, index) => {
    const sourceFilename =
      candidate.sourceFilename ?? filenameFromURL(candidate.url);
    const filename = uniqueFilename(
      safeArtifactFilename(
        sourceFilename,
        `asset-${sequence(index + 1)}`,
        candidate.contentType,
      ),
      usedFilenames,
    );
    const contentType =
      candidate.contentType ?? contentTypeForExtension(fileExtension(filename));
    return {
      filename,
      role: "asset",
      url: candidate.url,
      ...(candidate.originalURL ? { originalURL: candidate.originalURL } : {}),
      ...(contentType ? { contentType } : {}),
    };
  });
}

function sequence(value: number): string {
  return String(value).padStart(3, "0");
}

function isWriteHostedAssetURL(
  raw: string,
  handle: string,
  postId: string,
): boolean {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !url.hostname.toLowerCase().endsWith(".blob.vercel-storage.com")
    ) {
      return false;
    }

    const parts = decodedPathParts(url);
    if (!parts) return false;
    if (
      parts.length >= 4 &&
      parts[0] === "captures" &&
      parts[1] === handle &&
      parts[2] === postId
    ) {
      return true;
    }
    if (
      parts.length >= 5 &&
      parts[0] === "documents" &&
      parts[1] === handle &&
      parts[2] === postId &&
      parts[3] === "assets"
    ) {
      return true;
    }
    return (
      parts.length >= 4 &&
      parts[0] === "editor" &&
      parts[1] === "media" &&
      parts[2] === handle
    );
  } catch {
    return false;
  }
}

function decodedPathParts(url: URL): string[] | null {
  const parts: string[] = [];
  for (const encoded of url.pathname.split("/").filter(Boolean)) {
    let part: string;
    try {
      part = decodeURIComponent(encoded);
    } catch {
      return null;
    }
    if (
      !part ||
      part === "." ||
      part === ".." ||
      part.includes("/") ||
      part.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(part)
    ) {
      return null;
    }
    parts.push(part);
  }
  return parts;
}

function safeArtifactFilename(
  value: string | undefined,
  fallbackStem: string,
  contentType?: string,
): string {
  const source = lastPathSegment(value) ?? "";
  const sourceExtension = fileExtension(source);
  const extension =
    extensionForContentType(contentType) ?? sourceExtension ?? "bin";
  const withoutExtension = sourceExtension
    ? source.slice(0, -(sourceExtension.length + 1))
    : source;
  let stem = withoutExtension
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!stem) stem = fallbackStem;
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) {
    stem = `asset-${stem}`;
  }
  stem = stem.slice(
    0,
    Math.max(1, MAX_ARTIFACT_FILENAME_LENGTH - extension.length - 1),
  );
  return `${stem}.${extension}`;
}

function uniqueFilename(filename: string, used: Set<string>): string {
  if (!used.has(filename.toLowerCase())) {
    used.add(filename.toLowerCase());
    return filename;
  }

  const extension = fileExtension(filename) ?? "bin";
  const stem = filename.slice(0, -(extension.length + 1));
  for (let collision = 2; ; collision += 1) {
    const suffix = `-${collision}`;
    const available = Math.max(
      1,
      MAX_ARTIFACT_FILENAME_LENGTH - extension.length - suffix.length - 1,
    );
    const candidate = `${stem.slice(0, available)}${suffix}.${extension}`;
    if (used.has(candidate.toLowerCase())) continue;
    used.add(candidate.toLowerCase());
    return candidate;
  }
}

function lastPathSegment(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let pathname = value;
  try {
    pathname = new URL(value).pathname;
  } catch {
    // Capture filenames are not URLs; path separators are handled below.
  }
  const encoded = pathname.split(/[\\/]/).filter(Boolean).pop();
  if (!encoded) return undefined;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function filenameFromURL(raw: string): string | undefined {
  return lastPathSegment(raw);
}

function normalizedMediaContentType(
  contentType: string | undefined,
): string | undefined {
  const normalized = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  return normalized && /^(?:image|video)\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(normalized)
    ? normalized
    : undefined;
}

function extensionForContentType(contentType: string | undefined): string | undefined {
  switch (normalizedMediaContentType(contentType)) {
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

function fileExtension(filename: string | undefined): string | undefined {
  if (!filename) return undefined;
  const match = filename.toLowerCase().match(/\.([a-z0-9]{1,10})$/);
  return match?.[1];
}

function contentTypeForExtension(ext: string | undefined): string | undefined {
  switch (ext) {
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "webp": return "image/webp";
    case "gif": return "image/gif";
    case "avif": return "image/avif";
    case "svg": return "image/svg+xml";
    case "heic": return "image/heic";
    case "heif": return "image/heif";
    case "tif":
    case "tiff": return "image/tiff";
    case "mp4": return "video/mp4";
    case "mov": return "video/quicktime";
    case "webm": return "video/webm";
    case "mpg":
    case "mpeg": return "video/mpeg";
    case "m4v": return "video/x-m4v";
    case "ogv": return "video/ogg";
    default: return undefined;
  }
}
