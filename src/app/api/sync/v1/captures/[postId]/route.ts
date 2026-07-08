// Capture result upload (multipart/form-data):
//
//   PUT /api/sync/v1/captures/{postId}
//     meta       JSON string: {url, title?, siteName?, description?,
//                capturedBy?, error?} (error marks the capture failed)
//     readable   optional text field: readable extraction as markdown; lands
//                in the post body only when the body is empty
//     screenshot optional image file -> Blob
//     html       optional original page HTML or PDF file -> Blob
//
// -> {item: {id, slug, captureStatus}}. Artifacts go to Blob storage under
// captures/{handle}/{postId}/; their URLs land in posts.capture.

import type { BookmarkCapture } from "@/lib/content";
import { recordAction } from "@/lib/audit";
import { resolveItemAccess } from "@/lib/permissions";
import { revalidateBlogPaths } from "@/lib/revalidate-blog";
import { saveBookmarkCapture } from "@/lib/store";
import { resolveSyncWorkspace } from "../../auth";
import { syncError } from "../../sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;
// The readable extraction becomes the post body; a real article is well
// under this. Cap it so an oversized text field cannot bloat the row or the
// markdown round-trip.
const MAX_READABLE_BYTES = 2 * 1024 * 1024;

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

function oversizedFileError(file: File | null, label: string): string | null {
  if (!file || file.size <= MAX_ARTIFACT_BYTES) return null;
  return `${label} artifact is ${formatBytes(file.size)}; limit is ${formatBytes(MAX_ARTIFACT_BYTES)}`;
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

function isPDFFile(file: File): boolean {
  return fileType(file, "").toLowerCase().split(";")[0] === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");
}

function screenshotContentType(file: File): string {
  const type = fileType(file, "image/png").toLowerCase().split(";")[0];
  return type === "image/jpeg" ? "image/jpeg" : "image/png";
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
  const metaError = typeof meta.error === "string" && meta.error ? meta.error : null;

  const screenshot = formFile(form, "screenshot");
  const original = formFile(form, "html");
  const readableValue = form.get("readable");
  const readableMarkdown =
    typeof readableValue === "string" ? readableValue : undefined;
  const error =
    metaError ??
    oversizedFileError(screenshot, "Screenshot") ??
    oversizedFileError(original, "Original capture") ??
    oversizedReadableError(readableMarkdown);

  const capture: BookmarkCapture = {
    url,
    title: typeof meta.title === "string" ? meta.title : undefined,
    siteName: typeof meta.siteName === "string" ? meta.siteName : undefined,
    description:
      typeof meta.description === "string" ? meta.description : undefined,
    capturedAt: new Date().toISOString(),
    capturedBy: typeof meta.capturedBy === "string" ? meta.capturedBy : "agent",
    error: error ?? undefined,
  };

  // Artifacts only for successful captures; a failure report is metadata-only.
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!error && blobToken) {
    if (screenshot || original) {
      const { put } = await import("@vercel/blob");
      if (screenshot) {
        const contentType = screenshotContentType(screenshot);
        const screenshotName =
          contentType === "image/jpeg" ? "screenshot.jpg" : "screenshot.png";
        const blob = await put(
          `captures/${blog.handle}/${postId}/${screenshotName}`,
          screenshot,
          {
            access: "public",
            addRandomSuffix: true,
            contentType,
            token: blobToken,
          },
        );
        capture.screenshotUrl = blob.url;
      }
      if (original) {
        const isPDF = isPDFFile(original);
        const contentType = isPDF
          ? "application/pdf"
          : fileType(original, "text/html; charset=utf-8");
        const blob = await put(
          `captures/${blog.handle}/${postId}/${isPDF ? "original.pdf" : "page.html"}`,
          original,
          {
            access: "public",
            addRandomSuffix: true,
            contentType,
            token: blobToken,
          },
        );
        capture.htmlUrl = blob.url;
      }
    }
  }

  const saved = await saveBookmarkCapture(blog.handle, postId, capture, {
    readableMarkdown: error ? undefined : readableMarkdown,
    failed: Boolean(error),
  });
  if (!saved) return syncError(404, "No such bookmark");

  await recordAction({
    actorUserId: userId,
    actorType: "external_agent",
    actionName: "sync.capture_bookmark",
    targetType: "item",
    targetId: saved.id,
    inputSummary: url,
    outputSummary: error ? `failed: ${error}` : "captured",
  });
  revalidateBlogPaths(blog, [saved.slug]);
  return Response.json({
    item: { id: saved.id, slug: saved.slug, captureStatus: saved.captureStatus },
  });
}
