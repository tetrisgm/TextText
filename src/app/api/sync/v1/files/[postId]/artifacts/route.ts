import { resolveItemAccess } from "@/lib/permissions";
import { getPostById } from "@/lib/store";
import { resolveSyncWorkspace } from "../../../auth";
import { isUuid, renderSyncFile, syncError } from "../../../sync";

interface Props {
  params: Promise<{ postId: string }>;
}

type Artifact = {
  filename: string;
  role: "asset" | "screenshot";
  url: string;
  originalURL?: string;
  contentType?: string;
};

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: Props) {
  const workspace = await resolveSyncWorkspace(request);
  if (workspace instanceof Response) return workspace;

  const { postId } = await params;
  if (!isUuid(postId)) return syncError(404, "Post not found");
  const post = await getPostById(workspace.blog.handle, postId);
  if (!post || post.type !== "bookmark") {
    return syncError(404, "Bookmark not found");
  }
  const access = await resolveItemAccess({
    handle: workspace.blog.handle,
    postId,
    user: workspace,
  });
  if (!access.canView) return syncError(404, "Bookmark not found");

  const artifacts: Artifact[] = [];
  const seen = new Set<string>();
  const inline = post.capture?.assets ?? [];
  for (const [index, asset] of inline.entries()) {
    if (!isCaptureURL(asset.url, workspace.blog.handle, postId)) continue;
    if (seen.has(asset.url)) continue;
    seen.add(asset.url);
    artifacts.push({
      filename: `asset-${sequence(index + 1)}.${assetExtension(asset)}`,
      role: "asset",
      url: asset.url,
      originalURL: asset.originalUrl,
      contentType: asset.contentType,
    });
  }

  const tiles = [...(post.capture?.screenshotTiles ?? [])].sort(
    (left, right) => left.index - right.index,
  );
  const screenshots = tiles.length > 0
    ? tiles.map((tile) => tile.url)
    : post.capture?.screenshotUrl
      ? [post.capture.screenshotUrl]
      : [];
  for (const [index, url] of screenshots.entries()) {
    if (!isCaptureURL(url, workspace.blog.handle, postId)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    artifacts.push({
      filename: `screenshot-${sequence(index + 1)}.${urlExtension(url) ?? "png"}`,
      role: "screenshot",
      url,
      contentType: contentTypeForExtension(urlExtension(url) ?? "png"),
    });
  }

  return Response.json(
    {
      postId,
      slug: post.slug,
      fileHash: renderSyncFile(workspace.blog, post).hash,
      artifacts,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

function sequence(value: number): string {
  return String(value).padStart(3, "0");
}

function isCaptureURL(raw: string, handle: string, postId: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    if (!url.hostname.toLowerCase().endsWith(".blob.vercel-storage.com")) {
      return false;
    }
    const parts = url.pathname.split("/").filter(Boolean).map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return "";
      }
    });
    return parts[0] === "captures" && parts[1] === handle && parts[2] === postId;
  } catch {
    return false;
  }
}

function assetExtension(asset: {
  filename?: string;
  contentType?: string;
  url: string;
}): string {
  return extensionForContentType(asset.contentType)
    ?? fileExtension(asset.filename)
    ?? urlExtension(asset.url)
    ?? "bin";
}

function extensionForContentType(contentType?: string): string | undefined {
  switch (contentType?.split(";", 1)[0]?.trim().toLowerCase()) {
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/gif": return "gif";
    case "image/avif": return "avif";
    case "image/svg+xml": return "svg";
    default: return undefined;
  }
}

function fileExtension(filename?: string): string | undefined {
  if (!filename) return undefined;
  const match = filename.toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return match?.[1];
}

function urlExtension(raw: string): string | undefined {
  try {
    return fileExtension(new URL(raw).pathname);
  } catch {
    return undefined;
  }
}

function contentTypeForExtension(ext: string): string | undefined {
  switch (ext) {
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "webp": return "image/webp";
    case "gif": return "image/gif";
    case "avif": return "image/avif";
    case "svg": return "image/svg+xml";
    default: return undefined;
  }
}
